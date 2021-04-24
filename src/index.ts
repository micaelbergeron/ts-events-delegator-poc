import { v4 as uuidgen } from 'uuid'
import EventEmitter from 'events'

const emitter = new EventEmitter();

type uuid = string;
interface Delegator {
  id: uuid;
  apply: (args: any[]) => any;
}

// I could put the reference to the pool as a WeakRef here
interface Delegate {
    id: uuid;
    apply: (args: any[]) => Promise<any[]>;
}

type DelegateRequest = {
  id: uuid;
  rid: uuid;
  args: any[];
}

type DelegateReply = {
  rid: uuid;
  args: any[];
}

class Deferred<T> {
  private _resolve: (value: T) => void = () => {};
  private _reject: (value: T) => void = () => {};

  private _promise: Promise<T> = new Promise<T>((resolve, reject) => {
    this._reject = reject;
    this._resolve = resolve;
  })

  public get promise(): Promise<T> {
    return this._promise;
  }

  public resolve(value: T) {
    this._resolve(value);
  }

  public reject(value: T) {
    this._reject(value);
  }
}

class DelegatePool {
  pool: Record<uuid, Deferred<any[]>> = {};

  constructor() {
    emitter.on('ack', this.ack.bind(this))
  }

  create(id: uuid) {
    const delegator: Delegator = {
      id,
      apply: (args: any[]) => {
        return this.delegate(id, ...args)
      }
    }

    return delegator
  }

  delegate<TArgs extends any[]>(id: uuid, ...args: TArgs): Promise<any[]> {
    // generate a reply id for this delegate
    const rid = uuidgen();

    this.pool[rid] = new Deferred<any[]>()
    emitter.emit('delegate', {
      id,
      rid,
      args,
    } as DelegateRequest)

    // thus we can await this function
    return this.pool[rid].promise
  }

  ack(reply: DelegateReply) {
    console.log(`ack | rid: ${reply.rid}`)
    this.pool[reply.rid].resolve(reply.args)
  }
}

class DelegatorPool {
  pool: Record<uuid, Delegator> = {};

  constructor() {
    emitter.on('delegate', this.handle.bind(this))
  }

  create(fn: ((args: any[]) => void)) {
    const delegator: Delegator = {
      id: uuidgen(),
      apply: fn
    }

    return this.pool[delegator.id] = delegator;
  }

  handle(req: DelegateRequest) {
    // now we need to trigger the real handler
    // for this delegate, and send a reply to the
    // pool

    const delegate = this.pool[req.id]
    const result = delegate.apply(req.args)

    // now that we ran the delegator, we
    // can reply to the delegate that triggered
    emitter.emit('ack', { rid: req.rid, args: result })
  }
}

function createDelegator<TFunc>(fn: TFunc) {
}

function createDelegate<TFunc>(fn: TFunc) {
}


// we need to wire the rx transport,
// i.e. how does `ack` gets through
const delegators = new DelegatorPool();
const rx1 = delegators.create(() => 42)
const rx2 = delegators.create(() => 100)

// we need to wire the transport for the tx
// here, i.e. how does the `delegate` event
// gets through
const delegates = new DelegatePool();
const tx1 = delegates.create(rx1.id);
const tx2 = delegates.create(rx2.id);


// this should
// 1) emit delegate({ id: rx1.id, rid: tx1.rid, args })
// 2) on ack({ rid: tx1.rid, args })
// 3) resolve(args)
tx1.apply([]).then(console.log)
tx1.apply([]).then(console.log)
tx1.apply([]).then(console.log)
tx1.apply([]).then(console.log)
tx1.apply([]).then(console.log)
