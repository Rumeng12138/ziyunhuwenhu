const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const order={id:7,order_no:'TEST_ORDER',orderNo:'TEST_ORDER',total_amount:80,payAmount:80,status:'pending'};
const methods=[{id:'alipay_personal',enabled:true},{id:'wechat_personal',enabled:true},{id:'alipay',enabled:false}];
const receipt={order_id:7,order_no:'TEST_ORDER',payment_method:'alipay_personal',mode:'manual',amount:80,qrUrl:'/uploads/personal-alipay-initial.png'};
const normalizeOrder=o=>({...o,orderNo:o.order_no||o.orderNo,payAmount:o.total_amount??o.payAmount});
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
const flush=()=>new Promise(setImmediate);

for(const page of ['public/index.html','../frontend/index.html']){
  const html=fs.readFileSync(path.join(__dirname,'..',page),'utf8');
  test(page+': checkout displays exactly the products being quoted, including direct purchase',()=>{
    const {transform}=require(require.resolve('sucrase',{paths:[path.join(__dirname,'..'),path.dirname(require.resolve('tailwindcss/package.json'))]}));
    const component=html.slice(html.indexOf('  function CheckoutModal('),html.indexOf('  function OrdersModal('));
    const cartItem={product_id:1,name:'购物车毛笔',qty:2,price:10},directItem={product_id:2,name:'单独购买砚台',qty:1,price:30};
    const render=vm.runInNewContext(transform(component,{transforms:['jsx'],production:true,disableESTransforms:true}).code+';CheckoutModal',{
      React:{createElement:(tag,props,...children)=>({tag,props,children})}, Modal:'modal',
      useStore:()=>({cart:[cartItem],user:{id:1},addresses:[],features:{revision:0}}),
      useMemo:fn=>fn(),useState:value=>[value,()=>{}],useRef:current=>({current}),useEffect:()=>{},
      formatShortPrice:value=>'¥'+value,
    });
    const names=tree=>{
      if(Array.isArray(tree))return tree.flatMap(names);
      if(!tree||typeof tree!=='object')return [];
      return tree.props?.className==='order-product-name'?tree.children:tree.children.flatMap(names);
    };
    assert.deepEqual(names(render({open:true,directItem})),[directItem.name]);
    assert.deepEqual(names(render({open:true,directItem:null})),[cartItem.name]);
    const drawer=html.slice(html.indexOf('  function CartDrawer('),html.indexOf('  function LoginModal('));
    const renderCart=vm.runInNewContext(transform(drawer,{transforms:['jsx'],production:true,disableESTransforms:true}).code+';CartDrawer',{
      React:{createElement:(tag,props,...children)=>({tag,props,children}),Fragment:'fragment'},Icon:'icon',QuantityInput:'quantity',
      useStore:()=>({cart:[cartItem],cartCount:2,cartTotal:20,user:{id:1}}),useEffect:()=>{},formatShortPrice:value=>'¥'+value,
    });
    assert.match(JSON.stringify(renderCart({open:true})),/购物车毛笔/);
  });
  const source=html.slice(html.indexOf('  function paymentView('),html.indexOf('  function PaymentPanel('));
  const helpers=vm.runInNewContext(source+';({paymentView,validatePaymentSession})',{URL,API_BASE_URL:'/api',window:{location:{href:'https://shop.example/'}}});
  test(page+': only confirmed money shows success; paid goods still await shipment',()=>{
    assert.equal(helpers.paymentView(order,null).phase,'choose');
    assert.equal(helpers.paymentView(order,receipt).phase,'pay');
    assert.equal(helpers.paymentView({...order,status:'payment_review'},receipt).phase,'review');
    assert.equal(helpers.paymentView({...order,status:'paid'},receipt).phase,'unverified');
    assert.equal(helpers.paymentView({...order,status:'cancelled'},receipt).phase,'closed');
    for(const proof of [{payment_transaction_id:'provider-proof'},{manual_confirmed_at:'2026-08-28 10:00:00'}]){
      const view=helpers.paymentView({...order,status:'paid',...proof},receipt);assert.equal(view.phase,'success');assert.match(view.next,/等待商家发货/);
    }
    assert.match(helpers.paymentView({...order,status:'completed',manual_confirmed_at:'verified'},null).next,/订单已完成/);
  });
  test(page+': receipt sessions must match the order, amount, method and approved destinations',()=>{
    assert.equal(helpers.validatePaymentSession(receipt,order,'alipay_personal').qrUrl,'https://shop.example/uploads/personal-alipay-initial.png');
    for(const changes of [{order_id:8},{order_no:'OTHER'},{payment_method:'wechat_personal'},{amount:0.01},{qrUrl:'https://untrusted.example/qr.png'},{qrUrl:'/uploads/../private.png'}])
      assert.throws(()=>helpers.validatePaymentSession({...receipt,...changes},order,'alipay_personal'));
    for(const payUrl of ['http://openapi.alipay.com/pay','https://untrusted.example/pay','https://name@openapi.alipay.com/pay'])
      assert.throws(()=>helpers.validatePaymentSession({...receipt,payment_method:'alipay',payUrl},order,'alipay'));
    assert.ok(helpers.validatePaymentSession({...receipt,payment_method:'alipay',payUrl:'https://openapi.alipay.com/gateway.do'},order,'alipay'));
  });
  function mount(api,initial=order){
    const slots=[],effects=[],timers=new Map(),events=new Map();let cursor=0,nextTimer=1,updates=0;
    const context={
      normalizeOrder,API:api,URL,API_BASE_URL:'/api',
      window:{location:{href:'https://shop.example/'},addEventListener:(name,fn)=>events.set(name,fn),removeEventListener:(name,fn)=>{if(events.get(name)===fn)events.delete(name);}},
      useState:init=>{const i=cursor++;if(!(i in slots))slots[i]=typeof init==='function'?init():init;return[slots[i],value=>{slots[i]=typeof value==='function'?value(slots[i]):value;}];},
      useRef:value=>{const i=cursor++;if(!(i in slots))slots[i]={current:value};return slots[i];},
      useEffect:(fn,deps)=>{const i=cursor++,old=slots[i];if(!old||deps.some((d,n)=>d!==old.deps[n]))effects.push(()=>{old?.cleanup?.();slots[i]={deps,cleanup:fn()};});},
      setInterval:fn=>{const id=nextTimer++;timers.set(id,fn);return id;},clearInterval:id=>timers.delete(id),
    };
    const hook=vm.runInNewContext(source+';usePaymentFlow',context);
    const render=()=>{cursor=0;const state=hook(initial,()=>updates++);while(effects.length)effects.shift()();return state;};
    return{render,timers,events,get updates(){return updates;},unmount(){for(const s of slots)s?.cleanup?.();}};
  }
  test(page+': confirmation and transfer submission never optimistically complete an order',async()=>{
    let dbOrder={...order},posts=0;
    const app=mount({get:async url=>url==='/payment/methods'?methods:dbOrder,post:async url=>{posts++;if(url==='/payment/pay'){dbOrder={...dbOrder,payment_method:'alipay_personal',manual_receipt:'saved'};return receipt;}dbOrder={...dbOrder,status:'payment_review',manual_claim_reference:'test-reference'};return dbOrder;}});
    let flow=app.render();await Promise.resolve();flow=app.render();
    flow.chooseMethod('alipay');flow=app.render();assert.equal(flow.method,'alipay_personal');
    await flow.confirmPayment();flow=app.render();assert.equal(flow.current.status,'pending');assert.ok(flow.session);await Promise.resolve();
    flow.setReference('test-reference');flow=app.render();await flow.submitClaim();flow=app.render();
    assert.equal(flow.current.status,'payment_review');assert.equal(flow.current.manual_confirmed_at,undefined);assert.equal(posts,2);
    await flush();dbOrder={...dbOrder,status:'paid',manual_confirmed_at:'verified'};
    await flow.check();flow=app.render();assert.equal(flow.current.status,'paid');assert.equal(app.timers.size,0);assert.equal(app.events.size,0);
    app.unmount();
  });
  test(page+': duplicate clicks are locked and stale polling cannot undo transfer submission',async()=>{
    let dbOrder={...order},posts=0;const start=deferred(),stale=deferred();let hold=false;
    const app=mount({get:async url=>url==='/payment/methods'?methods:hold?stale.promise:dbOrder,post:async url=>{posts++;if(url==='/payment/pay')return start.promise;dbOrder={...dbOrder,status:'payment_review',manual_claim_reference:'test'};return dbOrder;}});
    let flow=app.render();await Promise.resolve();flow=app.render();
    const first=flow.confirmPayment();await flow.confirmPayment();assert.equal(posts,1);
    dbOrder={...dbOrder,payment_method:'alipay_personal',manual_receipt:'saved'};start.resolve(receipt);await first;
    hold=true;flow=app.render();flow.setReference('test');flow=app.render();
    await flow.submitClaim();assert.equal(posts,2);stale.resolve(dbOrder.status==='payment_review'?{...dbOrder,status:'pending'}:dbOrder);await Promise.resolve();await Promise.resolve();
    hold=false;flow=app.render();assert.equal(flow.current.status,'payment_review');
    app.unmount();
  });
  test(page+': lost payment response reconciles the bound method and cannot trigger a new-channel payment',async()=>{
    const bound={...order,payment_method:'alipay_personal',manual_receipt:'saved'};
    const app=mount({get:async url=>url==='/payment/methods'?methods:bound,post:async()=>{throw Error('network response lost');}});
    let flow=app.render();await Promise.resolve();flow=app.render();await flow.confirmPayment();flow=app.render();
    assert.equal(flow.current.payment_method,'alipay_personal');assert.equal(flow.current.status,'pending');
    flow.chooseMethod('wechat_personal');flow=app.render();assert.equal(flow.method,'alipay_personal');
    app.unmount();
  });
}
