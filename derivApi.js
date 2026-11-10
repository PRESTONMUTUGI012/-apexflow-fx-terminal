
class DerivAPIEngine {
  constructor(appId, token) {
    this.appId = appId;
    this.token = token;
    this.ws = null;
    this.isConnected = false;
    this.authorized = false;
    this.tickSubId = null;
    this.callbacks = {};
  }

  connect(onOpenCallback) {
    const wsUrl = `wss://ws.derivws.com/websockets/v3?app_id=${this.appId}`;
    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      this.isConnected = true;
      if (onOpenCallback) onOpenCallback();
      this.authorize();
      this.getActiveSymbols();
    };

    this.ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      this.handleIncomingMessage(data);
    };

    this.ws.onerror = (error) => {
      console.error("Deriv WS Error:", error);
    };

    this.ws.onclose = () => {
      this.isConnected = false;
      this.authorized = false;
      if (this.callbacks['disconnect']) this.callbacks['disconnect']();
    };
  }

  authorize() {
    this.send({ authorize: this.token });
  }

  getActiveSymbols() {
    this.send({ active_symbols: 'brief', product_type: 'basic' });
  }

  send(payload) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  subscribeTicks(symbol) {
    if (this.tickSubId) {
      this.send({ forget: this.tickSubId });
    }
    this.send({ ticks: symbol, subscribe: 1 });
  }

  async executeTrade({ symbol, amount, duration, duration_unit, contract_type }) {
    return this._attemptProposalAndBuy({ symbol, amount, duration, duration_unit, contract_type, barrier: null });
  }

  async executeTradeWithBarrier({ symbol, amount, duration, duration_unit, contract_type, barrier }) {
    return this._attemptProposalAndBuy({ symbol, amount, duration, duration_unit, contract_type, barrier });
  }

  _attemptProposalAndBuy({ symbol, amount, duration, duration_unit, contract_type, barrier }) {
    return new Promise((resolve, reject) => {
      const reqId = Date.now() + Math.floor(Math.random() * 1000);
      
      const proposalReq = {
        proposal: 1,
        amount: parseFloat(amount),
        basis: "stake",
        contract_type: contract_type,
        currency: "USD",
        duration: parseInt(duration),
        duration_unit: duration_unit,
        symbol: symbol,
        req_id: reqId
      };

      if (barrier !== null && barrier !== undefined) {
        proposalReq.barrier = barrier.toString();
      }

      let resolved = false;

      const handler = (data) => {
        if (data.req_id === reqId || data.echo_req?.req_id === reqId) {
          if (data.msg_type === 'proposal') {
            if (data.error) {
              resolved = true;
              delete this.callbacks[`resp_${reqId}`];
              reject(data.error);
              return;
            }
            this.send({
              buy: data.proposal.id,
              price: data.proposal.ask_price,
              req_id: reqId
            });
          }

          if (data.msg_type === 'buy') {
            resolved = true;
            delete this.callbacks[`resp_${reqId}`];
            if (data.error) {
              reject(data.error);
            } else {
              resolve({
                contract_id: data.buy.contract_id,
                buy_price: data.buy.buy_price,
                payout: data.buy.payout
              });
            }
          }
        }
      };

      this.callbacks[`resp_${reqId}`] = handler;
      this.send(proposalReq);

      setTimeout(() => {
        if (!resolved) {
          delete this.callbacks[`resp_${reqId}`];
          reject({ code: 'Timeout', message: 'Proposal/Buy request timed out.' });
        }
      }, 5000);
    });
  }

  handleIncomingMessage(data) {
    if (data.msg_type === 'authorize') {
      if (!data.error) {
        this.authorized = true;
        if (this.callbacks['authorize']) this.callbacks['authorize'](data.authorize);
      } else {
        if (this.callbacks['error']) this.callbacks['error'](data.error);
      }
    }

    if (data.msg_type === 'active_symbols') {
      if (this.callbacks['active_symbols']) this.callbacks['active_symbols'](data.active_symbols);
    }

    if (data.msg_type === 'tick') {
      if (data.tick && data.tick.id) this.tickSubId = data.tick.id;
      if (this.callbacks['tick']) this.callbacks['tick'](data.tick);
    }

    Object.keys(this.callbacks).forEach(key => {
      if (key.startsWith('resp_')) {
        this.callbacks[key](data);
      }
    });
  }

  on(event, callback) {
    this.callbacks[event] = callback;
  }
}
