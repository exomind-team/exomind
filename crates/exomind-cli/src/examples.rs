pub const HUMAN_EXAMPLES: &[&str] = &[
    "exomind rt status",
    "exomind rt probe",
    "exomind task add --profile argon --title \"整理浏览器标签\"",
    "exomind task list --profile argon --status pending",
    "exomind proposal approve --profile argon 12",
    "exomind eventlog add --profile argon --content \"补记今天的口述\"",
];

pub const AGENT_EXAMPLES: &[&str] = &[
    "exomind task list --profile argon --status pending --json",
    "exomind proposal add --profile argon --action create_task --title \"建议：整理标签\" --params-file -",
    "exomind eventlog add --profile argon --content \"补记今天的口述\" --json",
];
