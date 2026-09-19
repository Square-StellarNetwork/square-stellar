//! Amounts are `i128` at a contract's boundary, because SEP-41 is, and `u64`
//! in its records, as the EVM `uint64 budget` was
//! (docs/decisions/auth-and-token-flow.md, decision 7). At 7 decimals 2^64
//! base units are about 1.84 trillion tokens, the circuit's `Num2Bits(64)`
//! bound. A zero, negative or over-`u64` amount is refused at the boundary.

/// The `u64` a boundary amount records, or `None` when it is not positive or
/// does not fit. The caller turns `None` into its own error code.
pub fn to_record(amount: i128) -> Option<u64> {
    if amount <= 0 {
        return None;
    }
    u64::try_from(amount).ok()
}

/// A record amount back at the boundary.
pub fn to_boundary(amount: u64) -> i128 {
    i128::from(amount)
}

#[cfg(test)]
mod test {
    use super::*;

    #[test]
    fn boundary() {
        assert_eq!(to_record(0), None);
        assert_eq!(to_record(-1), None);
        assert_eq!(to_record(1), Some(1));
        assert_eq!(to_record(i128::from(u64::MAX)), Some(u64::MAX));
        assert_eq!(to_record(i128::from(u64::MAX) + 1), None);
        assert_eq!(to_record(i128::MAX), None);
        assert_eq!(to_boundary(u64::MAX), i128::from(u64::MAX));
    }
}
