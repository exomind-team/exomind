#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Rect {
    pub left: i32,
    pub top: i32,
    pub right: i32,
    pub bottom: i32,
}

/// 按 Windows 批准的右边缘重新施加期望宽度。
/// Re-applies the requested width while preserving Windows' approved right edge.
pub fn right_edge_rect(approved: Rect, width_px: i32) -> Rect {
    Rect {
        left: approved.right - width_px,
        ..approved
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn right_edge_keeps_the_approved_right_edge_and_requested_width() {
        let approved = Rect {
            left: 0,
            top: 0,
            right: 1920,
            bottom: 1040,
        };

        assert_eq!(
            right_edge_rect(approved, 320),
            Rect {
                left: 1600,
                top: 0,
                right: 1920,
                bottom: 1040,
            }
        );
    }

    #[test]
    fn right_edge_supports_a_monitor_with_negative_coordinates() {
        let approved = Rect {
            left: -1280,
            top: -120,
            right: 0,
            bottom: 904,
        };

        assert_eq!(
            right_edge_rect(approved, 280),
            Rect {
                left: -280,
                top: -120,
                right: 0,
                bottom: 904,
            }
        );
    }
}
