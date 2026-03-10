/**
 * Maps a Google Place Details object to our CompanyRow insert shape.
 * Extracts city and state from address_components when available.
 */

import { PlaceDetails, AddressComponent } from "./googlePlacesClient";
import { extractDomain } from "./domainUtils";

export interface MappedCompany {
  companyName: string | null;
  website: string | null;
  domain: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  googlePlaceId: string;
  source: string;
  rawPayload: string;
  lastSyncedAt: string;
}

function findComponent(
  components: AddressComponent[] | undefined,
  type: string
): string | null {
  return components?.find((c) => c.types.includes(type))?.long_name ?? null;
}

function findComponentShort(
  components: AddressComponent[] | undefined,
  type: string
): string | null {
  return components?.find((c) => c.types.includes(type))?.short_name ?? null;
}

export function mapPlaceDetails(details: PlaceDetails): MappedCompany {
  const website = details.website ?? null;

  return {
    companyName:   details.name ?? null,
    website,
    domain:        extractDomain(website),
    address:       details.formatted_address ?? null,
    city:          findComponent(details.address_components, "locality"),
    state:         findComponentShort(details.address_components, "administrative_area_level_1"),
    googlePlaceId: details.place_id,
    source:        "google_places",
    rawPayload:    JSON.stringify(details),
    lastSyncedAt:  new Date().toISOString(),
  };
}
