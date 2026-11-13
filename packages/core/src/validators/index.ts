// Provides VALIDATORS, the frozen registry of every validator name a rule may use (§3.5, plus
// not_git and not_mask of §3.4), and VALIDATOR_NAMES. The loader refuses a name not in it.
import * as asia from "./asia-pacific";
import * as contact from "./contact-network";
import * as europe from "./europe";
import * as general from "./general";
import * as latam from "./latam-africa";
import * as na from "./north-america";
import * as secrets from "./secrets";
import type { Validator } from "./types";

export type { Validator, ValidatorResult } from "./types";

export const VALIDATORS: Readonly<Record<string, Validator>> = Object.freeze({
  // general
  separators_consistent: general.separators_consistent,
  has_letter: general.has_letter,
  luhn: general.luhn,
  ean13: general.ean13,
  iban_mod97: general.iban_mod97,
  card_iin: general.card_iin,
  base58check: general.base58check,
  bech32: general.bech32,
  mrz_td3: general.mrz_td3,
  mrz_td2: general.mrz_td2,
  mrz_td1: general.mrz_td1,
  vin_na: general.vin_na,
  // North America
  ssn_rules: na.ssn_rules,
  itin_rules: na.itin_rules,
  ca_bn: na.ca_bn,
  nanp_rules: na.nanp_rules,
  // Europe
  be_nn: europe.be_nn,
  cz_rc: europe.cz_rc,
  es_dni: europe.es_dni,
  es_nie: europe.es_nie,
  fi_hetu: europe.fi_hetu,
  fr_nir: europe.fr_nir,
  nino_prefix: europe.nino_prefix,
  gb_dl_surname: europe.gb_dl_surname,
  ie_pps: europe.ie_pps,
  it_cf: europe.it_cf,
  no_fnr: europe.no_fnr,
  se_pnr: europe.se_pnr,
  eu_vat: europe.eu_vat,
  // Asia-Pacific
  cn_ric: asia.cn_ric,
  cn_uscc: asia.cn_uscc,
  hkid: asia.hkid,
  in_pan: asia.in_pan,
  in_gstin: asia.in_gstin,
  kr_rrn: asia.kr_rrn,
  sg_nric: asia.sg_nric,
  // Latin America and Africa
  br_cpf: latam.br_cpf,
  br_cnpj: latam.br_cnpj,
  mx_curp: latam.mx_curp,
  za_id: latam.za_id,
  // contact and network
  email_shape: contact.email_shape,
  ipv4_scope: contact.ipv4_scope,
  ipv6_parse: contact.ipv6_parse,
  mac_not_reserved: contact.mac_not_reserved,
  // secrets (§3.4)
  not_git: secrets.not_git,
  not_mask: secrets.not_mask,
});

export const VALIDATOR_NAMES: readonly string[] = Object.freeze(Object.keys(VALIDATORS).sort());
