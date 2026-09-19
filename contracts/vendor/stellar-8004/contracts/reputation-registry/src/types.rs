use soroban_sdk::{contracttype, String};

#[contracttype]
#[derive(Clone)]
pub struct FeedbackData {
    pub value: i128,
    pub value_decimals: u32,
    pub is_revoked: bool,
    pub tag1: String,
    pub tag2: String,
}

#[contracttype]
#[derive(Clone)]
pub struct SummaryResult {
    pub count: u64,
    pub summary_value: i128,
    pub summary_value_decimals: u32,
}
