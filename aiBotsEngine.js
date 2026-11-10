class AISpeedBotsEngine {
  constructor(derivApiEngine, logCallback) {
    this.api = derivApiEngine;
    this.log = logCallback || console.log;
    this.activeBot = null; 
    this.lastDigits = [];
    this.tickHistory = [];
    this.isExecuting = false;
    this.inRecoveryMode = false;
  }

  setBot(botType) {
    this.activeBot = botType;
    this.lastDigits = [];
    this.tickHistory = [];
    this.isExecuting = false;
    this.inRecoveryMode = false;
    this.log(`[AI Speed Boat] Activated strategy: ${botType.toUpperCase()}`, 'bot');
  }

  stopBot() {
    this.activeBot = null;
    this.isExecuting = false;
    this.inRecoveryMode = false;
    this.log("[AI Speed Boat] All speed boats disengaged.", 'warning');
  }

  async processTick(tick) {
    if (!this.activeBot || this.isExecuting || !this.api.authorized) return;

    const priceStr = tick.quote.toString();
    const decimalSplit = priceStr.split('.');
    const fractionalPart = decimalSplit[1] || '0';
    const lastDecimal = parseInt(fractionalPart.slice(-1));
    const currentPrice = parseFloat(tick.quote);

    this.lastDigits.push(lastDecimal);
    if (this.lastDigits.length > 50) this.lastDigits.shift();

    this.tickHistory.push(currentPrice);
    if (this.tickHistory.length > 50) this.tickHistory.shift();

    if (this.inRecoveryMode) {
      await this.runRecoveryExecution();
      return;
    }

    if (this.activeBot === 'top_down_trend') {
      await this.runTopDownTrendSpeedBoat();
    } else if (this.activeBot === 'even_odd') {
      await this.runEvenOddSpeedBoat();
    } else if (this.activeBot === 'matches') {
      await this.runMatchesSpeedBoat();
    } else if (this.activeBot === 'differs') {
      await this.runDiffersSpeedBoat();
    } else if (this.activeBot === 'rise_fall') {
      await this.runRiseFallSpeedBoat();
    } else if (this.activeBot === 'over3_under6') {
      await this.runOver3Under6SpeedBoat(lastDecimal);
    } else if (this.activeBot === 'multi_low_digits') {
      await this.runMultiLowDigitsSpeedBoat();
    } else if (this.activeBot === 'extreme_edges') {
      await this.runExtremeEdgesSpeedBoat(lastDecimal);
    }
  }

  async runRecoveryExecution() {
    this.isExecuting = true;
    const symbol = document.getElementById('select-market').value;
    const baseStake = parseFloat(document.getElementById('input-stake').value);
    const recoveryStake = (baseStake * 1.5).toFixed(2);

    const recentDigit = this.lastDigits[this.lastDigits.length - 1] || 5;
    let contractType = recentDigit >= 5 ? 'DIGITUNDER' : 'DIGITOVER';
    let barrier = recentDigit >= 5 ? '5' : '4';

    this.log(`[Recovery Mode Active] Executing ${contractType} (Barrier ${barrier}) @ $${recoveryStake}...`, 'warning');

    try {
      const res = await this.api.executeTradeWithBarrier({
        symbol: symbol,
        amount: recoveryStake,
        duration: 1,
        duration_unit: 't',
        contract_type: contractType,
        barrier: barrier
      });
      this.log(`[Recovery Success] ID: ${res.contract_id} | Payout: $${res.payout}`, 'success');
      this.inRecoveryMode = false;
    } catch (err) {
      this.log(`[Recovery Execution Error]: ${err.message || err.code}`, 'error');
    }

    setTimeout(() => { this.isExecuting = false; }, 2500);
  }

  // =========================================================================
  // TOP-DOWN 15M BIAS + 1M EXECUTION SPEED BOAT (12-CANDLE HOLD WINDOW)
  // =========================================================================
  async runTopDownTrendSpeedBoat() {
    if (this.tickHistory.length < 30) return;

    // Macro Structure Analysis (Higher Timeframe Multi-Tick Rolling Bias)
    const macroSegment = this.tickHistory.slice(-30);
    const macroStart = macroSegment[0];
    const macroEnd = macroSegment[macroSegment.length - 1];
    const macroBullish = macroEnd > macroStart;

    // Micro Execution Confirmation (Lower Timeframe Momentum Trigger)
    const microSegment = this.tickHistory.slice(-10);
    const microStart = microSegment[0];
    const microEnd = microSegment[microSegment.length - 1];
    const microBullish = microEnd > microStart;

    let contractType = null;
    if (macroBullish && microBullish) {
      contractType = 'CALL';
    } else if (!macroBullish && !microBullish) {
      contractType = 'PUT';
    }

    if (contractType) {
      this.isExecuting = true;
      const symbol = document.getElementById('select-market').value;
      const stake = document.getElementById('input-stake').value;
      
      this.log(`[Top-Down Speed Boat] Macro Trend Confirmed (${macroBullish ? 'BULLISH' : 'BEARISH'}). Firing 12-Candle Hold Window...`, 'bot');

      try {
        const res = await this.api.executeTrade({
          symbol: symbol,
          amount: stake,
          duration: 12, // Contract duration set to 12 ticks/candles
          duration_unit: 't',
          contract_type: contractType
        });
        this.log(`[Top-Down Success] ${contractType} (12 Ticks Hold) | ID: ${res.contract_id} | Payout: $${res.payout}`, 'success');
      } catch (err) {
        this.log(`[Top-Down Error]: ${err.message || err.code}`, 'error');
        this.inRecoveryMode = true;
      }

      setTimeout(() => { this.isExecuting = false; }, 6000);
    }
  }

  async runEvenOddSpeedBoat() {
    if (this.lastDigits.length < 10) return;
    const recent10 = this.lastDigits.slice(-10);
    const evens = recent10.filter(d => d % 2 === 0).length;
    const odds = 10 - evens;

    let contractType = null;
    if (evens >= 8) contractType = 'DIGITODD';
    else if (odds >= 8) contractType = 'DIGITEVEN';

    if (contractType) {
      this.isExecuting = true;
      const symbol = document.getElementById('select-market').value;
      const stake = document.getElementById('input-stake').value;
      try {
        const res = await this.api.executeTrade({ symbol, amount: stake, duration: 1, duration_unit: 't', contract_type: contractType });
        this.log(`[Even/Odd Success] ID: ${res.contract_id} | Payout: $${res.payout}`, 'success');
      } catch (err) { 
        this.log(`[Even/Odd Error]: ${err.message || err.code}`, 'error');
        this.inRecoveryMode = true;
      }
      setTimeout(() => { this.isExecuting = false; }, 2000);
    }
  }

  async runMatchesSpeedBoat() {
    if (this.lastDigits.length < 20) return;
    const counts = {};
    this.lastDigits.slice(-20).forEach(d => { counts[d] = (counts[d] || 0) + 1; });
    let targetDigit = 0, maxFreq = 0;
    for (let d in counts) {
      if (counts[d] > maxFreq) { maxFreq = counts[d]; targetDigit = parseInt(d); }
    }

    if (maxFreq >= 5) {
      this.isExecuting = true;
      const symbol = document.getElementById('select-market').value;
      const stake = document.getElementById('input-stake').value;
      try {
        const res = await this.api.executeTradeWithBarrier({ symbol, amount: stake, duration: 1, duration_unit: 't', contract_type: 'DIGITMATCH', barrier: targetDigit.toString() });
        this.log(`[Matches Success] Digit ${targetDigit} | ID: ${res.contract_id}`, 'success');
      } catch (err) { 
        this.log(`[Matches Error]: ${err.message || err.code}`, 'error');
        this.inRecoveryMode = true;
      }
      setTimeout(() => { this.isExecuting = false; }, 2500);
    }
  }

  async runDiffersSpeedBoat() {
    if (this.lastDigits.length < 15) return;
    const counts = {};
    for (let i = 0; i <= 9; i++) counts[i] = 0;
    this.lastDigits.slice(-15).forEach(d => { counts[d]++; });

    let rarestDigit = 0, minFreq = 999;
    for (let d in counts) {
      if (counts[d] < minFreq) { minFreq = counts[d]; rarestDigit = parseInt(d); }
    }

    this.isExecuting = true;
    const symbol = document.getElementById('select-market').value;
    const stake = document.getElementById('input-stake').value;
    try {
      const res = await this.api.executeTradeWithBarrier({ symbol, amount: stake, duration: 1, duration_unit: 't', contract_type: 'DIGITDIFF', barrier: rarestDigit.toString() });
      this.log(`[Differs Success] Avoid Digit ${rarestDigit} | ID: ${res.contract_id} | Payout: $${res.payout}`, 'success');
    } catch (err) {
      this.log(`[Differs Error]: ${err.message || err.code}`, 'error');
      this.inRecoveryMode = true;
    }
    setTimeout(() => { this.isExecuting = false; }, 2500);
  }

  async runRiseFallSpeedBoat() {
    if (this.tickHistory.length < 3) return;
    const p1 = this.tickHistory[this.tickHistory.length - 1];
    const p2 = this.tickHistory[this.tickHistory.length - 2];
    const p3 = this.tickHistory[this.tickHistory.length - 3];

    let contractType = null;
    if (p1 > p2 && p2 > p3) contractType = 'CALL';
    else if (p1 < p2 && p2 < p3) contractType = 'PUT';

    if (contractType) {
      this.isExecuting = true;
      const symbol = document.getElementById('select-market').value;
      const stake = document.getElementById('input-stake').value;
      try {
        const res = await this.api.executeTrade({ symbol, amount: stake, duration: 1, duration_unit: 't', contract_type: contractType });
        this.log(`[Rise/Fall Success] ${contractType} | ID: ${res.contract_id}`, 'success');
      } catch (err) { 
        this.log(`[Rise/Fall Error]: ${err.message || err.code}`, 'error');
        this.inRecoveryMode = true;
      }
      setTimeout(() => { this.isExecuting = false; }, 1500);
    }
  }

  async runOver3Under6SpeedBoat(lastDigit) {
    if (this.lastDigits.length < 10) return;
    let contractType = lastDigit <= 3 ? 'DIGITOVER' : lastDigit >= 6 ? 'DIGITUNDER' : null;
    let barrier = lastDigit <= 3 ? '3' : '6';

    if (contractType) {
      this.isExecuting = true;
      const symbol = document.getElementById('select-market').value;
      const stake = document.getElementById('input-stake').value;
      try {
        const res = await this.api.executeTradeWithBarrier({ symbol, amount: stake, duration: 1, duration_unit: 't', contract_type: contractType, barrier: barrier });
        this.log(`[Over3/Under6 Success] ${contractType} Barrier ${barrier} | ID: ${res.contract_id}`, 'success');
      } catch (err) { 
        this.log(`[Over3/Under6 Error]: ${err.message || err.code}`, 'error');
        this.inRecoveryMode = true;
      }
      setTimeout(() => { this.isExecuting = false; }, 2000);
    }
  }

  async runMultiLowDigitsSpeedBoat() {
    this.isExecuting = true;
    const symbol = document.getElementById('select-market').value;
    const stake = document.getElementById('input-stake').value;
    const barriers = ['0', '1', '2'];

    this.log(`[Multi-Low Speed Boat] Firing simultaneous Over 0, 1, & 2...`, 'bot');
    for (let b of barriers) {
      try {
        this.api.executeTradeWithBarrier({ symbol, amount: stake, duration: 1, duration_unit: 't', contract_type: 'DIGITOVER', barrier: b })
          .then(res => this.log(`[Over ${b} Success] ID: ${res.contract_id}`, 'success'))
          .catch(e => { this.inRecoveryMode = true; });
      } catch(e) {}
    }
    setTimeout(() => { this.isExecuting = false; }, 3000);
  }

  async runExtremeEdgesSpeedBoat(lastDigit) {
    if (this.lastDigits.length < 5) return;
    let contractType = null, barrier = null;

    if (lastDigit >= 7) { contractType = 'DIGITOVER'; barrier = '6'; }
    else if (lastDigit <= 2) { contractType = 'DIGITUNDER'; barrier = '3'; }

    if (contractType) {
      this.isExecuting = true;
      const symbol = document.getElementById('select-market').value;
      const stake = document.getElementById('input-stake').value;
      try {
        const res = await this.api.executeTradeWithBarrier({ symbol, amount: stake, duration: 1, duration_unit: 't', contract_type: contractType, barrier: barrier });
        this.log(`[Edge Success] ${contractType} ${barrier} | ID: ${res.contract_id}`, 'success');
      } catch (err) { 
        this.log(`[Edge Error]: ${err.message || err.code}`, 'error');
        this.inRecoveryMode = true;
      }
      setTimeout(() => { this.isExecuting = false; }, 2000);
    }
  }
}
