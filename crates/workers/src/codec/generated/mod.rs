#[allow(clippy::missing_safety_doc)]
#[cfg(canary_generated_flatbuffers)]
pub mod claim_generated {
    include!(concat!(env!("OUT_DIR"), "/claim_generated.rs"));
}

#[allow(clippy::missing_safety_doc)]
#[cfg(not(canary_generated_flatbuffers))]
pub mod claim_generated;
