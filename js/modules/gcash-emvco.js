/**
 * Module Description: Offline EMVCo Merchant-Presented QR Parser & Dynamic Payload Engine
 * Implements the Bangko Sentral ng Pilipinas (BSP) QR Ph / EMVCo MPM specification.
 * Parses Tag-Length-Value (TLV) payloads, mutates transaction amount (Tag 54)
 * and point of initiation (Tag 01), and computes CRC-16/CCITT-FALSE checksums.
 */

export const GCashEMVCo = {
  // Fallback base static merchant QR payload if none uploaded in store settings
  basePayload: "00020101021126580009PH.P2PQR011112345678901020460165204541153036085802PH5913MERCHANT NAME6007TARLAC 6304",

  /**
   * Recalculates CRC-16/CCITT-FALSE (Polynomial: 0x1021, Init: 0xFFFF)
   * @param {string} payloadWithoutCrc - Assembled TLV string ending with "6304"
   * @returns {string} 4-character uppercase hexadecimal CRC
   */
  computeCRC(payloadWithoutCrc) {
    let crc = 0xffff;
    const str = payloadWithoutCrc + "6304";
    for (let i = 0; i < str.length; i++) {
      crc ^= str.charCodeAt(i) << 8;
      for (let j = 0; j < 8; j++) {
        if ((crc & 0x8000) !== 0) {
          crc = ((crc << 1) ^ 0x1021) & 0xffff;
        } else {
          crc = (crc << 1) & 0xffff;
        }
      }
    }
    return crc.toString(16).toUpperCase().padStart(4, "0");
  },

  /**
   * Parses standard EMVCo Tag-Length-Value (TLV) string into an ordered Map
   * @param {string} raw - Raw EMVCo payload string
   * @returns {Map<string, string>} Tag-value mapping
   */
  parseTLV(raw) {
    const tags = new Map();
    if (!raw || typeof raw !== "string") return tags;

    let i = 0;
    while (i < raw.length) {
      if (i + 4 > raw.length) break;

      const tag = raw.substring(i, i + 2);
      const len = parseInt(raw.substring(i + 2, i + 4), 10);

      if (!tag || isNaN(len) || len < 0 || i + 4 + len > raw.length) {
        break;
      }

      const val = raw.substring(i + 4, i + 4 + len);
      tags.set(tag, val);
      i += 4 + len;
    }
    return tags;
  },

  /**
   * Takes base merchant payload and generates a dynamic QR string with exact amount
   * @param {number|string} amount - Payable transaction total
   * @returns {string} EMVCo QR Ph formatted payload string
   */
  generateDynamicPayload(amount) {
    const numericAmount = Math.max(0, Number(amount) || 0);
    const amountStr = numericAmount.toFixed(2);
    const tags = this.parseTLV(this.basePayload);

    // 1. Tag 01: Set Point of Initiation Method to '12' (Dynamic QR)
    tags.set("01", "12");

    // 2. Tag 53: Set Transaction Currency to PHP ('608')
    tags.set("53", "608");

    // 3. Tag 54: Set exact Transaction Amount
    tags.set("54", amountStr);

    // 4. Strip existing Tag 63 (CRC checksum)
    tags.delete("63");

    // 5. Reassemble string maintaining sequential order
    let assembled = "";
    for (const [tag, val] of tags.entries()) {
      const len = String(val.length).padStart(2, "0");
      assembled += `${tag}${len}${val}`;
    }

    // 6. Compute and append fresh 16-bit CRC checksum
    const crc = this.computeCRC(assembled);
    return `${assembled}6304${crc}`;
  },

  /**
   * Updates base merchant payload from administrative store configuration
   * @param {string} newRawPayload
   */
  setBasePayload(newRawPayload) {
    if (newRawPayload && typeof newRawPayload === "string" && newRawPayload.includes("6304")) {
      this.basePayload = newRawPayload.trim();
    }
  }
};

// REMARK: GCASH_EMVCO_JS_MODULARIZATION_COMPLETE