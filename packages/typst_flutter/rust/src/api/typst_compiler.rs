use std::collections::HashMap;

use anyhow::{anyhow, Result};
use flutter_rust_bridge::frb;
use typst_as_lib::TypstEngine;
use typst_library::foundations::{Dict, Str, Value};
use typst_pdf::PdfOptions;

// ── Types ──────────────────────────────────────────────────────────────────

/// Extra file (image, .typ include) for the compiler.
/// `path` is the virtual path used in the template (e.g. "logo.png")
pub struct TypstFileInput {
    pub path: String,
    pub data: Vec<u8>,
}

/// Result of a successful compilation.
pub struct CompileResult {
    /// Generated PDF bytes — ready to save or display.
    pub pdf_bytes: Vec<u8>,
    /// Non-fatal warnings emitted by the Typst compiler.
    pub warnings: Vec<String>,
}

// ── Main API ───────────────────────────────────────────────────────────────

/// Compiles a Typst template and returns the PDF bytes.
///
/// - `template`   : main .typ file content (UTF-8)
/// - `inputs`     : data injected as sys.inputs (HashMap -> Dict)
/// - `fonts`      : additional font bytes (.ttf/.otf)
/// - `extra_files`: extra files (images, sub-templates)
#[frb]
pub fn compile(
    template: String,
    inputs: Option<HashMap<String, String>>,
    fonts: Vec<Vec<u8>>,
    extra_files: Vec<TypstFileInput>,
) -> Result<CompileResult> {
    let mut builder = TypstEngine::builder().main_file(template.as_str());

    for font in &fonts {
        builder = builder.fonts([font.as_slice()]);
    }

    if !extra_files.is_empty() {
        let pairs: Vec<(&str, &[u8])> = extra_files
            .iter()
            .map(|f| (f.path.as_str(), f.data.as_slice()))
            .collect();
        builder = builder.with_static_file_resolver(pairs);
    }

    let engine = builder.build();

    let result = match inputs {
        Some(inputs) => {
            let mut dict = Dict::new();
            for (key, value) in inputs {
                dict.insert(Str::from(key), Value::Str(Str::from(value)));
            }
            engine.compile_with_input(dict)
        }
        None => engine.compile(),
    };

    let warnings: Vec<String> = result.warnings.iter().map(|w| format!("{w:?}")).collect();

    let doc = result
        .output
        .map_err(|err| anyhow!("Typst compile error: {err:?}"))?;

    let pdf_bytes =
        typst_pdf::pdf(&doc, &PdfOptions::default()).map_err(|e| anyhow!("PDF error: {e:?}"))?;

    Ok(CompileResult {
        pdf_bytes,
        warnings,
    })
}

// ── discover_inputs ────────────────────────────────────────────────────────

use typst_syntax::{ast, ast::AstNode, SyntaxNode};

/// A discovered input field from a Typst template.
pub struct DiscoveredInput {
    pub name: String,
    pub required: bool,
    pub default_value: Option<String>,
}

/// Discovers all `sys.inputs.at(...)` calls in a Typst template via AST analysis.
/// No compilation needed — pure syntax analysis.
#[frb]
pub fn discover_inputs(source: String) -> Vec<DiscoveredInput> {
    let root = typst_syntax::parse(&source);
    let mut fields = Vec::new();
    walk_for_inputs(&root, &mut fields);
    // Deduplicate by name, keep first occurrence
    let mut seen = std::collections::HashSet::new();
    fields.retain(|f| seen.insert(f.name.clone()));
    fields
}

fn walk_for_inputs(node: &SyntaxNode, fields: &mut Vec<DiscoveredInput>) {
    if let Some(call) = node.cast::<ast::FuncCall>() {
        if let ast::Expr::FieldAccess(access) = call.callee() {
            if access.field().as_str() == "at" {
                if is_sys_inputs(access.target()) {
                    extract_input_field(call.args(), fields);
                }
            }
        }
    }
    for child in node.children() {
        walk_for_inputs(child, fields);
    }
}

fn is_sys_inputs(expr: ast::Expr) -> bool {
    if let ast::Expr::FieldAccess(access) = expr {
        if access.field().as_str() == "inputs" {
            if let ast::Expr::Ident(ident) = access.target() {
                return ident.as_str() == "sys";
            }
        }
    }
    false
}

fn extract_input_field(args: ast::Args, fields: &mut Vec<DiscoveredInput>) {
    let mut name = None;
    let mut default_value = None;

    for arg in args.items() {
        match arg {
            ast::Arg::Pos(expr) => {
                if name.is_none() {
                    if let ast::Expr::Str(s) = expr {
                        name = Some(s.get().to_string());
                    }
                }
            }
            ast::Arg::Named(named) => {
                if named.name().as_str() == "default" {
                    if let ast::Expr::Str(s) = named.expr() {
                        default_value = Some(s.get().to_string());
                    } else {
                        default_value = Some(named.expr().to_untyped().text().to_string());
                    }
                }
            }
            _ => {}
        }
    }

    if let Some(field_name) = name {
        fields.push(DiscoveredInput {
            name: field_name,
            required: default_value.is_none(),
            default_value,
        });
    }
}

// ── Tests ──────────────────────────────────────────────────────────────────
#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    #[test]
    fn test_compile_simple_returns_pdf() {
        let result = compile("= Hello".to_string(), None, vec![], vec![]).unwrap();

        assert_eq!(&result.pdf_bytes[..4], b"%PDF");
        assert!(result.warnings.is_empty());
    }

    #[test]
    fn test_compile_with_dict_input() {
        let template = r#"
#import sys: inputs
= #inputs.at("titulo", default: "")
"#
        .to_string();

        let inputs = HashMap::from([("titulo".to_string(), "Test".to_string())]);

        let result = compile(template, Some(inputs), vec![], vec![]).unwrap();

        assert_eq!(&result.pdf_bytes[..4], b"%PDF");
    }

    #[test]
    fn test_invalid_template_returns_error() {
        let result = compile("#funcao_inexistente()".to_string(), None, vec![], vec![]);

        assert!(result.is_err());
    }

    #[test]
    fn test_larger_content_produces_larger_pdf() {
        let small = compile("= A".to_string(), None, vec![], vec![]).unwrap();

        let large_template = (0..30)
            .map(|i| format!("== Section {i}\n\n{}\n", "Lorem ipsum ".repeat(20)))
            .collect::<Vec<_>>()
            .join("\n");

        let large = compile(large_template, None, vec![], vec![]).unwrap();

        assert!(large.pdf_bytes.len() > small.pdf_bytes.len());
    }

    #[test]
    fn test_discover_inputs_basic() {
        let source = r#"
#let name = sys.inputs.at("sender_name")
#let city = sys.inputs.at("sender_city")
#let closing = sys.inputs.at("closing", default: "MfG")
"#;
        let inputs = discover_inputs(source.to_string());
        assert_eq!(inputs.len(), 3);
        assert_eq!(inputs[0].name, "sender_name");
        assert!(inputs[0].required);
        assert_eq!(inputs[2].name, "closing");
        assert!(!inputs[2].required);
        assert_eq!(inputs[2].default_value, Some("MfG".to_string()));
    }

    #[test]
    fn test_discover_inputs_deduplication() {
        let source = r#"
#let a = sys.inputs.at("name")
#let b = sys.inputs.at("name")
"#;
        let inputs = discover_inputs(source.to_string());
        assert_eq!(inputs.len(), 1);
    }

    #[test]
    fn test_discover_inputs_empty_template() {
        let inputs = discover_inputs("= Hello World".to_string());
        assert!(inputs.is_empty());
    }

    #[test]
    fn test_discover_inputs_inline_usage() {
        let source = r#"Hello #sys.inputs.at("name"), welcome to #sys.inputs.at("city", default: "Berlin")!"#;
        let inputs = discover_inputs(source.to_string());
        assert_eq!(inputs.len(), 2);
        assert_eq!(inputs[0].name, "name");
        assert!(inputs[0].required);
        assert_eq!(inputs[1].name, "city");
        assert!(!inputs[1].required);
        assert_eq!(inputs[1].default_value, Some("Berlin".to_string()));
    }
}
