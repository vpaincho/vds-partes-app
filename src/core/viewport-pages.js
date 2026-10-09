// Viewport navigation without page scroll. Nodes are retained, not cloned, so
// bindings, forms and edits remain intact across internal pages.
export function installViewportPages(root,{key='',remember=new Map()}={}){
  const candidates=root.querySelectorAll('.rail>nav,.edbody,.view:not(.flush),.vscroll,.vlist,.db,.mb,[data-keep="s"]');
  for(const [index,region] of [...candidates].entries()){
    if(region.clientHeight<180||region.dataset.paged)continue;
    const available=region.clientHeight,original=[...region.children];if(!original.length)continue;
    region.dataset.paged='true';region.classList.add('viewport-paged');
    const stage=document.createElement('div');stage.className='viewport-stage';
    const bar=document.createElement('nav');bar.className='viewport-nav';bar.setAttribute('aria-label','Páginas de esta sección');
    const prev=document.createElement('button'),next=document.createElement('button'),label=document.createElement('span');
    for(const b of [prev,next]){b.type='button';b.className='btn'}prev.textContent='Anterior';next.textContent='Siguiente';label.setAttribute('aria-live','polite');bar.append(prev,label,next);region.replaceChildren(stage,bar);
    const limit=Math.max(120,available-76),units=[];
    const flatten=node=>{
      if(node.matches('.grid2,.grid3,.stack,.cards,.feature-layout,.feature-list')&&!node.querySelector('form')){for(const child of [...node.children])flatten(child)}else units.push(node);
    };
    original.forEach(flatten);stage.append(...units);
    // Tables have their own row and column navigation when larger than a page.
    for(const wrap of stage.querySelectorAll('.scrollx')){
      const table=wrap.querySelector('table');if(!table)continue;
      const rows=[...table.querySelectorAll('tbody>tr')];if(rows.length<2)continue;
      const overhead=Math.max(120,wrap.closest('.pnl')?.getBoundingClientRect().height-wrap.getBoundingClientRect().height||120);
      const rowHeight=Math.max(48,...rows.map(r=>r.getBoundingClientRect().height));
      const count=Math.max(1,Math.floor((limit-overhead-52)/rowHeight));if(count>=rows.length)continue;
      const controls=document.createElement('nav');controls.className='viewport-nav';controls.setAttribute('aria-label','Filas de la tabla');
      let page=0;const a=document.createElement('button'),b=document.createElement('button'),l=document.createElement('span');a.type=b.type='button';a.className=b.className='btn';a.textContent='Filas anteriores';b.textContent='Más filas';controls.append(a,l,b);wrap.after(controls);
      const draw=()=>{rows.forEach((r,i)=>r.hidden=i<page*count||i>=(page+1)*count);a.disabled=page===0;b.disabled=(page+1)*count>=rows.length;l.textContent=`${page*count+1}–${Math.min(rows.length,(page+1)*count)} / ${rows.length}`};a.onclick=()=>{page--;draw()};b.onclick=()=>{page++;draw()};draw();
    }
    const pages=[];let group=[],height=0;
    for(const unit of units){const h=unit.getBoundingClientRect().height+16;if(group.length&&height+h>limit){pages.push(group);group=[];height=0}group.push(unit);height+=h}if(group.length)pages.push(group);
    const id=key+':'+index;let page=Math.min(remember.get(id)||0,pages.length-1);
    const draw=()=>{const visible=new Set(pages[page]);units.forEach(n=>n.hidden=!visible.has(n));prev.disabled=page===0;next.disabled=page===pages.length-1;label.textContent=`Página ${page+1} de ${pages.length}`;remember.set(id,page);stage.scrollTop=0;
      // A single unusually tall panel remains accessible by bounded pages too.
      const large=stage.scrollHeight>stage.clientHeight+2;stage.dataset.large=String(large);sub.hidden=!large;offset=0;drawSub();};
    const sub=document.createElement('nav');sub.className='viewport-nav viewport-subnav';sub.setAttribute('aria-label','Detalle de panel');const up=document.createElement('button'),down=document.createElement('button'),pos=document.createElement('span');up.type=down.type='button';up.className=down.className='btn';up.textContent='Detalle anterior';down.textContent='Más detalle';sub.append(up,pos,down);bar.before(sub);
    let offset=0;const drawSub=()=>{const step=Math.max(48,stage.clientHeight-64),max=Math.max(0,stage.scrollHeight-stage.clientHeight);offset=Math.min(max,Math.max(0,offset));stage.scrollTop=offset;up.disabled=offset===0;down.disabled=offset>=max;pos.textContent=`Detalle ${Math.floor(offset/step)+1}`};up.onclick=()=>{offset-=Math.max(48,stage.clientHeight-64);drawSub()};down.onclick=()=>{offset+=Math.max(48,stage.clientHeight-64);drawSub()};prev.onclick=()=>{page--;draw()};next.onclick=()=>{page++;draw()};draw();
    if(pages.length===1)bar.hidden=true;
    if(typeof ResizeObserver!=='undefined'){const observer=new ResizeObserver(()=>{if(region.isConnected)draw();else observer.disconnect()});observer.observe(region);}
  }
  for(const wrap of root.querySelectorAll('.scrollx')){
    if(wrap.clientWidth<100||wrap.scrollWidth<=wrap.clientWidth+2||wrap.dataset.columnsPaged)continue;
    wrap.dataset.columnsPaged='true';wrap.style.overflowX='hidden';
    const controls=document.createElement('nav');controls.className='viewport-nav';controls.setAttribute('aria-label','Columnas de la tabla');
    const prev=document.createElement('button'),next=document.createElement('button'),label=document.createElement('span');prev.type=next.type='button';prev.className=next.className='btn';prev.textContent='Columnas anteriores';next.textContent='Más columnas';controls.append(prev,label,next);wrap.after(controls);
    let offset=0;const draw=()=>{const max=wrap.scrollWidth-wrap.clientWidth;offset=Math.min(max,Math.max(0,offset));wrap.scrollLeft=offset;prev.disabled=offset===0;next.disabled=offset>=max;label.textContent='Columnas de la tabla'};prev.onclick=()=>{offset-=Math.max(80,wrap.clientWidth-120);draw()};next.onclick=()=>{offset+=Math.max(80,wrap.clientWidth-120);draw()};draw();
  }
}
