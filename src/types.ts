export interface SearchInput {
  from: string;
  to: string;
  depart: string;
  return?: string;
  passengers: number;
  class: CabinClass;
  stops: StopFilter;
  sort: SortOption;
  headed: boolean;
}

export type CabinClass = "economy" | "premium-economy" | "business" | "first";
export type StopFilter = "any" | "nonstop" | "1stop";
export type SortOption = "price" | "duration" | "departure" | "arrival";

export interface FlightLeg {
  from: string;
  to: string;
  airline: string;
  flight_number: string | null;
  departure: string;
  arrival: string;
}

export interface FlightResult {
  airline: string;
  price: number | null;
  currency: string;
  departure: string;
  arrival: string;
  duration_minutes: number;
  stops: number;
  legs: FlightLeg[];
}
