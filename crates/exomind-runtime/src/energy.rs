use serde::Serialize;
use std::collections::HashMap;
use std::sync::{Arc, RwLock};

// ---------------------------------------------------------------------------
// AgentEnergy — per-agent energy pool with frequency-scaling support
// ---------------------------------------------------------------------------

pub struct AgentEnergy {
    state: RwLock<EnergyState>,
    max: u64,
    tick_cost: u64,
}

struct EnergyState {
    current: u64,
}

impl AgentEnergy {
    pub fn new(max: u64, tick_cost: u64) -> Self {
        Self {
            state: RwLock::new(EnergyState { current: max }),
            max,
            tick_cost,
        }
    }

    pub fn current(&self) -> u64 {
        self.state.read().unwrap().current
    }

    pub fn max(&self) -> u64 {
        self.max
    }

    pub fn tick_cost(&self) -> u64 {
        self.tick_cost
    }

    pub fn ratio(&self) -> f64 {
        if self.max == 0 {
            return 0.0;
        }
        self.current() as f64 / self.max as f64
    }

    pub fn is_dormant(&self) -> bool {
        self.current() == 0
    }

    /// Consume `amount` energy.  Returns `false` if already dormant (current == 0).
    /// Otherwise subtracts with saturating semantics and returns `true`.
    pub fn consume(&self, amount: u64) -> bool {
        let mut state = self.state.write().unwrap();
        if state.current == 0 {
            return false;
        }
        state.current = state.current.saturating_sub(amount);
        true
    }

    /// Refill energy by `amount`, capping at `max`. Returns the new current value.
    pub fn refill(&self, amount: u64) -> u64 {
        let mut state = self.state.write().unwrap();
        state.current = (state.current + amount).min(self.max);
        state.current
    }

    /// Directly set the current energy level, capping at `max`.
    /// Used for per-block dynamic initial energy.
    pub fn set_current(&self, value: u64) {
        let mut state = self.state.write().unwrap();
        state.current = value.min(self.max);
    }

    /// Compute the tick interval (seconds) adjusted for the current energy ratio.
    ///
    /// | ratio        | multiplier |
    /// |--------------|------------|
    /// | > 0.8        | 1×         |
    /// | > 0.5        | 2×         |
    /// | > 0.2        | 4×         |
    /// | ≤ 0.2        | 7× (max 20)|
    pub fn adjusted_tick_interval(&self, base_secs: u64) -> u64 {
        let r = self.ratio();
        if r > 0.8 {
            base_secs
        } else if r > 0.5 {
            base_secs * 2
        } else if r > 0.2 {
            base_secs * 4
        } else {
            (base_secs * 7).min(20)
        }
    }

    /// Human-readable lifecycle phase derived from ratio.
    pub fn phase(&self) -> &'static str {
        if self.is_dormant() {
            return "dormant";
        }
        let r = self.ratio();
        if r > 0.8 {
            "normal"
        } else if r > 0.5 {
            "slowing"
        } else if r > 0.2 {
            "critical"
        } else {
            "dying"
        }
    }

    /// Produce a serializable snapshot of the current energy state.
    pub fn snapshot(&self, agent_id: &str) -> AgentEnergySnapshot {
        AgentEnergySnapshot {
            agent_id: agent_id.to_string(),
            current: self.current(),
            max: self.max,
            ratio: self.ratio(),
            tick_cost: self.tick_cost,
            phase: self.phase().to_string(),
            is_dormant: self.is_dormant(),
        }
    }
}

// ---------------------------------------------------------------------------
// AgentEnergySnapshot — serializable point-in-time view
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
pub struct AgentEnergySnapshot {
    pub agent_id: String,
    pub current: u64,
    pub max: u64,
    pub ratio: f64,
    pub tick_cost: u64,
    pub phase: String,
    pub is_dormant: bool,
}

// ---------------------------------------------------------------------------
// EnergyRegistry — global registry of per-agent energy pools
// ---------------------------------------------------------------------------

#[derive(Clone, Default)]
pub struct EnergyRegistry {
    pools: Arc<RwLock<HashMap<String, Arc<AgentEnergy>>>>,
}

impl EnergyRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn register(&self, agent_id: &str, energy: AgentEnergy) {
        self.pools
            .write()
            .unwrap()
            .insert(agent_id.to_string(), Arc::new(energy));
    }

    pub fn get(&self, agent_id: &str) -> Option<Arc<AgentEnergy>> {
        self.pools.read().unwrap().get(agent_id).cloned()
    }

    pub fn all_snapshots(&self) -> Vec<AgentEnergySnapshot> {
        self.pools
            .read()
            .unwrap()
            .iter()
            .map(|(id, e)| e.snapshot(id))
            .collect()
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_pool_starts_full() {
        let pool = AgentEnergy::new(100, 5);
        assert_eq!(pool.current(), 100);
        assert!((pool.ratio() - 1.0).abs() < f64::EPSILON);
        assert!(!pool.is_dormant());
    }

    #[test]
    fn consume_reduces_energy() {
        let pool = AgentEnergy::new(100, 5);
        assert!(pool.consume(30));
        assert_eq!(pool.current(), 70);
    }

    #[test]
    fn consume_clamps_to_zero() {
        let pool = AgentEnergy::new(100, 5);
        pool.consume(80); // 100 → 20
        assert!(pool.consume(50)); // 20 → 0 (saturating)
        assert_eq!(pool.current(), 0);
        assert!(pool.is_dormant());
    }

    #[test]
    fn consume_on_dormant_returns_false() {
        let pool = AgentEnergy::new(100, 5);
        pool.consume(100); // → 0
        assert!(pool.is_dormant());
        assert!(!pool.consume(1));
    }

    #[test]
    fn refill_caps_at_max() {
        let pool = AgentEnergy::new(100, 5);
        pool.consume(60); // → 40
        let new_val = pool.refill(200);
        assert_eq!(new_val, 100);
        assert_eq!(pool.current(), 100);
    }

    #[test]
    fn tick_interval_scales_with_energy() {
        let base = 2u64;
        let pool = AgentEnergy::new(100, 5);

        // ratio 1.0 → 1× = 2
        assert_eq!(pool.adjusted_tick_interval(base), 2);

        // ratio 0.7 → 2× = 4
        pool.consume(30); // current = 70
        assert_eq!(pool.adjusted_tick_interval(base), 4);

        // ratio 0.4 → 4× = 8
        pool.consume(30); // current = 40
        assert_eq!(pool.adjusted_tick_interval(base), 8);

        // ratio 0.1 → 7× = 14, min(20) → 14
        pool.consume(30); // current = 10
        assert_eq!(pool.adjusted_tick_interval(base), 14);
    }

    #[test]
    fn snapshot_captures_state() {
        let pool = AgentEnergy::new(200, 10);
        pool.consume(50); // current = 150

        let snap = pool.snapshot("agent-alpha");
        assert_eq!(snap.agent_id, "agent-alpha");
        assert_eq!(snap.current, 150);
        assert_eq!(snap.max, 200);
        assert!((snap.ratio - 0.75).abs() < f64::EPSILON);
        assert_eq!(snap.tick_cost, 10);
        assert_eq!(snap.phase, "slowing");
        assert!(!snap.is_dormant);
    }

    #[test]
    fn registry_tracks_multiple_agents() {
        let reg = EnergyRegistry::new();
        reg.register("a", AgentEnergy::new(100, 5));
        reg.register("b", AgentEnergy::new(200, 10));

        assert!(reg.get("a").is_some());
        assert!(reg.get("b").is_some());
        assert!(reg.get("c").is_none());

        let snaps = reg.all_snapshots();
        assert_eq!(snaps.len(), 2);
    }
}
