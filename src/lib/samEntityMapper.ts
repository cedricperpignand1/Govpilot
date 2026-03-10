/**
 * Maps a raw SAM Entity Management API record to our flat ContractorRow shape.
 * Every field access is guarded — if SAM returns a different structure we
 * store null rather than crashing the sync.
 */

import { SamEntityData } from "./samEntityClient";

export interface MappedContractor {
  entityName: string | null;
  legalBusinessName: string | null;
  uei: string | null;
  cageCode: string | null;
  ncageCode: string | null;
  physicalAddressLine1: string | null;
  physicalAddressCity: string | null;
  physicalAddressState: string | null;
  physicalAddressZip: string | null;
  country: string | null;
  naicsCodes: string;   // JSON array string e.g. '["236220","238210"]'
  businessTypes: string; // JSON array string
  registrationStatus: string | null;
  activationDate: string | null;
  expirationDate: string | null;
  website: string | null;
  phone: string | null;
  rawPayload: string;
  source: string;
  lastSyncedAt: string;
}

export function mapEntity(entity: SamEntityData): MappedContractor {
  const reg  = entity.entityRegistration;
  const core = entity.coreData;
  const addr = core?.physicalAddress;
  const info = core?.entityInformation;
  const biz  = core?.businessTypes;
  const naicsData = entity.assertions?.goodsAndServices;
  const poc  = entity.pointsOfContact;

  // Prefer governmentBusinessPOC phone, then electronicBusinessPOC
  const phone =
    poc?.governmentBusinessPOC?.usPhone ??
    poc?.electronicBusinessPOC?.usPhone ??
    poc?.pastPerformancePOC?.usPhone ??
    null;

  // Collect all NAICS codes on this entity (not just the primary one we queried)
  const naicsCodes: string[] = [];
  if (naicsData?.naicsList) {
    for (const n of naicsData.naicsList) {
      if (n.naicsCode) naicsCodes.push(n.naicsCode);
    }
  } else if (naicsData?.primaryNaics) {
    naicsCodes.push(naicsData.primaryNaics);
  }

  const businessTypes: string[] = [];
  if (biz?.businessTypeList) {
    for (const b of biz.businessTypeList) {
      if (b.businessTypeDesc) businessTypes.push(b.businessTypeDesc);
    }
  }
  if (biz?.sbaBusinessTypeList) {
    for (const b of biz.sbaBusinessTypeList) {
      if (b.sbaBusinessTypeDesc) businessTypes.push(b.sbaBusinessTypeDesc);
    }
  }

  const name = reg?.legalBusinessName ?? reg?.dbaName ?? null;

  return {
    entityName:           name,
    legalBusinessName:    reg?.legalBusinessName ?? null,
    uei:                  reg?.ueiSAM ?? null,
    cageCode:             reg?.cageCode ?? null,
    ncageCode:            reg?.nCageCode ?? null,
    physicalAddressLine1: addr?.addressLine1 ?? null,
    physicalAddressCity:  addr?.city ?? null,
    physicalAddressState: addr?.stateOrProvinceCode ?? null,
    physicalAddressZip:   addr?.zipCode ?? null,
    country:              addr?.countryCode ?? null,
    naicsCodes:           JSON.stringify(naicsCodes),
    businessTypes:        JSON.stringify(businessTypes),
    registrationStatus:   reg?.registrationStatus ?? null,
    activationDate:       reg?.activationDate ?? null,
    expirationDate:       reg?.registrationExpirationDate ?? null,
    website:              info?.entityURL ?? null,
    phone,
    rawPayload:           JSON.stringify(entity),
    source:               "sam_entity_v3",
    lastSyncedAt:         new Date().toISOString(),
  };
}
