export interface AgentMarketCategory {
  id: string;
  label: string;
}

export interface AgentMarketItem {
  id: string;
  name: string;
  summary: string;
  icon: string;
  tintColor: string;
  tags: string[];
  installsText: string;
  ratingText: string;
}
