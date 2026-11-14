use serde::{Deserialize, Deserializer, Serialize};
use std::{fmt, str::FromStr};
use uuid::Uuid;

#[derive(Debug, thiserror::Error)]
pub enum InvalidIdentifier {
    #[error("invalid UUID: {0}")]
    Uuid(#[from] uuid::Error),
    #[error("nil identifiers are invalid")]
    Nil,
}

// These identifiers share a wire representation and validation rule, but
// remain distinct types so profile/device/command IDs cannot be interchanged.
macro_rules! identifier {
    ($name:ident) => {
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
        #[serde(transparent)]
        pub struct $name(Uuid);

        impl $name {
            pub fn new() -> Self {
                Self(Uuid::new_v4())
            }
        }

        impl Default for $name {
            fn default() -> Self {
                Self::new()
            }
        }

        impl fmt::Display for $name {
            fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                self.0.fmt(formatter)
            }
        }

        impl FromStr for $name {
            type Err = InvalidIdentifier;
            fn from_str(value: &str) -> Result<Self, Self::Err> {
                let id = Uuid::parse_str(value)?;
                if id.is_nil() {
                    return Err(InvalidIdentifier::Nil);
                }
                Ok(Self(id))
            }
        }

        impl<'de> Deserialize<'de> for $name {
            fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
                let value = Uuid::deserialize(deserializer)?;
                if value.is_nil() {
                    return Err(serde::de::Error::custom("nil identifiers are invalid"));
                }
                Ok(Self(value))
            }
        }
    };
}

identifier!(ProfileId);
identifier!(DeviceId);
identifier!(CommandId);
identifier!(EventId);
identifier!(AgentId);
identifier!(StageId);
identifier!(OriginalId);
identifier!(TimeblockId);

impl AgentId {
    pub(crate) fn uuid(self) -> Uuid {
        self.0
    }
}
