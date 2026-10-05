(function (global) {
  'use strict';

  var TILOPAY_FEE_PERCENT = 0.175;
  var TILOPAY_FEE_FIXED_CRC = 185;

  function roundMoney(n) {
    return Math.round(Number(n) || 0);
  }

  function computeTilopayPricing(baseTotalCrc) {
    var baseTotal = Math.max(0, roundMoney(baseTotalCrc));
    var percentFee = roundMoney(baseTotal * TILOPAY_FEE_PERCENT);
    var fixedFee = TILOPAY_FEE_FIXED_CRC;
    var feeSubtotal = percentFee + fixedFee;
    var feeIva = 0;
    var serviceFees = feeSubtotal;
    var tilopayTotal = baseTotal + serviceFees;
    return {
      baseTotal: baseTotal,
      percentFee: percentFee,
      fixedFee: fixedFee,
      feeSubtotal: feeSubtotal,
      feeIva: feeIva,
      serviceFees: serviceFees,
      tilopayTotal: tilopayTotal,
      percentLabel: (TILOPAY_FEE_PERCENT * 100).toFixed(1) + '%',
      ivaRate: 0,
    };
  }

  function formatFeeBreakdown(pricing) {
    var p = pricing || computeTilopayPricing(0);
    return p.percentLabel + ' + \u20A1' + p.fixedFee.toLocaleString('es-CR');
  }

  global.NLTilopayFees = {
    computeTilopayPricing: computeTilopayPricing,
    formatFeeBreakdown: formatFeeBreakdown,
    TILOPAY_FEE_PERCENT: TILOPAY_FEE_PERCENT,
    TILOPAY_FEE_FIXED_CRC: TILOPAY_FEE_FIXED_CRC,
  };
})(typeof window !== 'undefined' ? window : this);
