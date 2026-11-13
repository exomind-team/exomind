use exomind_beta_host::BetaHost;
use exomind_core::{Core, ProfileId};

#[test]
fn recovery_guard_host_never_recreates_missing_or_blank_initialized_core_storage() {
    for blank in [false, true] {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().join("host");
        let host = BetaHost::open(&root).unwrap();
        let owner = host.owner_session().unwrap();
        host.provision_profile(&owner, ProfileId::new(), "preserved synthetic profile")
            .unwrap();
        host.stop().unwrap();
        drop(host);
        let credentials = std::fs::read(root.join("connection.beta.json")).unwrap();
        let main = root.join("core/beta-core.sqlite3");
        if blank {
            std::fs::write(&main, []).unwrap();
        } else {
            std::fs::remove_file(&main).unwrap();
        }
        assert!(
            BetaHost::open(&root).is_err(),
            "a surviving owner must not silently bind a new empty business database"
        );
        assert_eq!(
            std::fs::read(root.join("connection.beta.json")).unwrap(),
            credentials
        );
        if blank {
            assert_eq!(std::fs::metadata(main).unwrap().len(), 0);
        } else {
            assert!(!main.exists());
        }
    }
}

#[test]
fn recovery_guard_host_rejects_replacement_core_identity_without_rebinding_owner() {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().join("host");
    let host = BetaHost::open(&root).unwrap();
    let device = host.status().unwrap().device_id;
    host.stop().unwrap();
    drop(host);
    let credentials = std::fs::read(root.join("connection.beta.json")).unwrap();
    let replacement_root = directory.path().join("replacement");
    let replacement = Core::open(&replacement_root).unwrap();
    assert_ne!(replacement.device_id(), device);
    drop(replacement);
    std::fs::copy(
        replacement_root.join("beta-core.sqlite3"),
        root.join("core/beta-core.sqlite3"),
    )
    .unwrap();
    assert!(
        BetaHost::open(&root).is_err(),
        "persistent owner authority must stay bound to its original device"
    );
    assert_eq!(
        std::fs::read(root.join("connection.beta.json")).unwrap(),
        credentials
    );
}

#[test]
fn recovery_guard_host_rejects_missing_auth_database_instead_of_losing_its_grants() {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().join("host");
    let host = BetaHost::open(&root).unwrap();
    host.stop().unwrap();
    drop(host);
    let auth = root.join("host-auth.sqlite3");
    std::fs::remove_file(&auth).unwrap();
    let credentials = std::fs::read(root.join("connection.beta.json")).unwrap();
    assert!(
        BetaHost::open(&root).is_err(),
        "an initialized host must not recreate its authorization database"
    );
    assert!(!auth.exists());
    assert_eq!(
        std::fs::read(root.join("connection.beta.json")).unwrap(),
        credentials
    );
}
