use crate::{CoreError, MAX_FACT_BYTES};
use serde::Serialize;

/// Keep the durable encoding readable by every bounded fact reader. The input
/// field limits remain separate: JSON escaping can expand valid local text.
pub(crate) fn encode_fact(fact: &impl Serialize) -> Result<String, CoreError> {
    let encoded = serde_json::to_string(fact)?;
    if encoded.len() > MAX_FACT_BYTES {
        return Err(CoreError::FactTooLarge {
            max_bytes: MAX_FACT_BYTES,
        });
    }
    Ok(encoded)
}
