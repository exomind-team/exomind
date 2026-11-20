use std::{io, path::{Path, PathBuf}};

pub(crate) fn recovery_root(host_root: &Path) -> io::Result<PathBuf> {
    if !host_root.is_absolute() {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, "absolute Host root required"));
    }
    let stem = host_root.file_name().ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "Host root needs a directory name"))?;
    let name = if stem == "beta-host" {
        std::ffi::OsString::from("beta-native-profile-archive")
    } else {
        let mut name = stem.to_os_string();
        name.push("-profile-archive");
        name
    };
    Ok(host_root.with_file_name(name))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn archive_recovery_follows_the_selected_host_scope() {
        let own = std::env::temp_dir().join("exomind-path-scope-fixture");
        let platform = own.join("installed-beta-data");
        let first = recovery_root(&own.join("test-instance").join("host-a")).unwrap();
        let second = recovery_root(&own.join("test-instance").join("host-b")).unwrap();
        assert!(first.starts_with(own.join("test-instance")));
        assert!(!first.starts_with(&platform));
        assert_ne!(first, second);
    }

    #[test]
    fn default_host_keeps_the_platform_sibling_layout() {
        let platform = std::env::temp_dir().join("exomind-default-path-fixture");
        assert_eq!(recovery_root(&platform.join("beta-host")).unwrap(), platform.join("beta-native-profile-archive"));
    }
}
