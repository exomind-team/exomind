use crate::cli::RootCommand;
use crate::examples::{AGENT_EXAMPLES, HUMAN_EXAMPLES};

pub fn print_json(value: &serde_json::Value) -> Result<(), String> {
    let rendered = serde_json::to_string_pretty(value).map_err(|error| error.to_string())?;
    println!("{rendered}");
    Ok(())
}

pub fn homepage_text() -> String {
    format!(
        concat!(
            "ExoMind CLI\n",
            "RT client shell (RT 客户端外壳) for task / proposal / eventlog\n",
            "\n",
            "Default behavior (默认行为):\n",
            "  - connect-first (优先连接)\n",
            "  - do not spawn RT unless explicitly requested\n",
            "\n",
            "Common examples:\n",
            "{human_examples}\n",
            "Agent-friendly usage:\n",
            "{agent_examples}\n",
            "More:\n",
            "  exomind examples\n",
            "  exomind task --help\n",
            "  exomind proposal --help\n",
            "  exomind eventlog --help\n",
            "  exomind rt --help\n"
        ),
        human_examples = format_examples(HUMAN_EXAMPLES),
        agent_examples = format_examples(AGENT_EXAMPLES),
    )
}

pub fn examples_text() -> String {
    format!(
        concat!(
            "ExoMind CLI examples (命令样例)\n",
            "\n",
            "Human usage:\n",
            "{human_examples}\n",
            "Agent-friendly usage:\n",
            "{agent_examples}"
        ),
        human_examples = format_examples(HUMAN_EXAMPLES),
        agent_examples = format_examples(AGENT_EXAMPLES),
    )
}

pub fn placeholder_command_text(command: &RootCommand) -> String {
    format!(
        "Command placeholder (占位输出): {command:?}\nUse `exomind examples` for current samples.\n"
    )
}

fn format_examples(examples: &[&str]) -> String {
    examples
        .iter()
        .map(|example| format!("  {example}"))
        .collect::<Vec<_>>()
        .join("\n")
        + "\n\n"
}
