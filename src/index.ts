import { v4 as uuidgen } from 'uuid'
import EventEmitter from 'events'


function emit<T>(emitter: EventEmitter, event: string, payload: T) {
  queueMicrotask(() => {
    emitter.emit(event, payload)
    })
}

const debug = (message: string, anything: any) => console.log(message, JSON.stringify(anything));

const emitter = new EventEmitter();
emitter.on('register', (req: any) => debug('register |', req))
emitter.on('@register', (reply: any) => debug('@register |', reply))

emitter.on('delegate', (req: any) => debug('delegate |', req))
emitter.on('@delegate', (reply: any) => debug('@delegate |', reply))

emitter.on('unregister', (req: any) => debug('unregister |', req))

type uuid = string;

interface Delegated {
  id: uuid;
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

type RegisterRequest = {
  senderId: uuid;
  delegatorId: uuid;
}
type UnregisterRequest = RegisterRequest;

type RegisterReply = {
  delegatorId: uuid;
}

class Deferred<T> {
  private _resolve: (value: T) => void = () => { };
  private _reject: (value: T) => void = () => { };

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
  delegates: Set<uuid> = new Set();
  pool: Record<uuid, Deferred<any[]>> = {};

  constructor() {
    emitter.on('@delegate', this.handleDelegateReply.bind(this))
    emitter.on('unregister', this.handleUnregisterRequest.bind(this))
  }

  create(id: uuid) {
    const delegate = (args: any[]) => this.delegate(id, ...args)
    this.delegates.add(id)

    return delegate
  }

  delegate<TArgs extends any[]>(id: uuid, ...args: TArgs): Promise<any[]> {
    // check whether the delegate is still registered
    if (!this.delegates.has(id)) throw new Error(`Unregistered delegate ${id} was called`);

    // generate a reply id for this delegate
    const rid = uuidgen();

    this.pool[rid] = new Deferred<any[]>()
    emit(emitter, 'delegate', {
      id,
      rid,
      args,
    } as DelegateRequest)

    // thus we can await this function
    return this.pool[rid].promise
  }

  handleDelegateReply(reply: DelegateReply): void {
    this.pool[reply.rid].resolve(reply.args)
  }

  // removing this from the pool effectively disable
  // the closure that was originally created for
  // this delegate
  handleUnregisterRequest(req: UnregisterRequest): void {
    this.delegates.delete(req.delegatorId)
  }
}

class DelegatorPool {
  id: uuid = uuidgen()
  pool: Record<uuid, Function> = {};
  uponRegister: Record<uuid, Deferred<void>> = {};

  constructor() {
    emitter.on('delegate', this.handleDelegateRequest.bind(this))
    emitter.on('@register', this.handleRegisterReply.bind(this))
  }

  create<TFunc extends Function>(fn: TFunc): [uuid, TFunc] {
    // let's create a Proxy object for this
    const id = uuidgen();

    // send the registration, and add it to the pool once that's
    this.pool[id] = fn;

    return [id, fn]
  }

  // we will have to use the tx transport here
  // to send register all delegator automatically on it
  register(delegatorId: uuid): Promise<void> {
    // this should probably time-out and then reject if
    const deferred = this.uponRegister[delegatorId] = new Deferred<void>()

    emit(emitter, 'register', { delegatorId, senderId: this.id })

    return deferred.promise
  }

  handleDelegateRequest(req: DelegateRequest) {
    // now we need to trigger the real handler
    // for this delegate, and send a reply to the
    // pool

    const delegate = this.pool[req.id]
    const result = delegate.apply(null, req.args)

    // now that we ran the delegator, we
    // can reply to the delegate that triggered
    emit(emitter, '@delegate', { rid: req.rid, args: result })
  }

  handleRegisterReply(req: RegisterReply) {
    this.uponRegister[req.delegatorId].resolve();
  }

  dispose() {
    Object.keys(this.pool).forEach((delegatorId) => {
      emit(emitter, 'unregister', { delegatorId, senderId: this.id });
    })
  }
}

function createDelegator<TFunc>(fn: TFunc) {
}

function createDelegate<TFunc>(fn: TFunc) {
}


async function main() {
  // we need to wire the transport for the tx
  // here, i.e. how does the `delegate` event
  // gets through
  const delegates = new DelegatePool();

  // in reality, this comes from the RPC with the rest of the
  // extension to be registered
  emitter.on('register', (req: RegisterRequest) => {
    const tx = delegates.create(req.delegatorId);

    // we could probably leverage SoA instead of
    // AoS to have multiplexing built-in
    //
    // i.e. emitter.emit('@register', { id: [id1, id2] })
    emit(emitter, '@register', { delegatorId: req.delegatorId })

    // this should
    // 1) emit delegate({ id: rx1.id, rid: tx1.rid, args })
    // 2) on ack({ rid: tx1.rid, args })
    // 3) resolve(args)
    setInterval(() => { tx([1]).then(console.log) }, 1000);
  })

  // we need to wire the rx transport,
  // i.e. how does `ack` gets through
  const delegators = new DelegatorPool();
  const [id1, rx1] = delegators.create((x: number) => 42 + x)
  const [id2, rx2] = delegators.create(() => 100)

  await delegators.register(id1);

  // as we can see here, the original fn is preserved
  console.log(rx1(0))

  // let's dispose the delegator and see what happens
  setTimeout(() => {
    console.log('Disposing all delegators')
    delegators.dispose();
  }, 4000)
}

main();
