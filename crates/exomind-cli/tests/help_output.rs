use assert_cmd::Command;

#[test]
fn running_without_args_renders_homepage_help() {
    let assert = Command::cargo_bin("exomind")
        .expect("exomind binary should exist")
        .assert()
        .success();

    let output = String::from_utf8(assert.get_output().stdout.clone()).expect("utf8 stdout");
    assert!(output.contains("ExoMind CLI"));
    assert!(output.contains("connect-first"));
    assert!(output.contains("Common examples"));
    assert!(output.contains("Agent-friendly usage"));
}

#[test]
fn examples_command_lists_human_and_agent_examples() {
    let assert = Command::cargo_bin("exomind")
        .expect("exomind binary should exist")
        .args(["examples"])
        .assert()
        .success();

    let output = String::from_utf8(assert.get_output().stdout.clone()).expect("utf8 stdout");
    assert!(output.contains("task add"));
    assert!(output.contains("proposal approve"));
    assert!(output.contains("eventlog add"));
    assert!(output.contains("--json"));
    assert!(output.contains("--params-file"));
}
