use flutter_rust_bridge::frb;

pub mod api;
mod frb_generated;

#[frb(init)]
pub fn init_app() {}
