const $=id=>document.getElementById(id);
let maintenanceToken=sessionStorage.getItem("rvmMaintenanceToken")||"";
let mediaVersion="",mediaItems=[],mediaIndex=0,mediaTimer=null,mediaVisible=false;
const rupiah=value=>new Intl.NumberFormat("id-ID",{style:"currency",currency:"IDR",maximumFractionDigits:0}).format(Number(value||0));
const label=value=>String(value||"").replaceAll("_"," ");
const escapeHtml=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));

function stopMedia(){
  if(mediaTimer){clearTimeout(mediaTimer);mediaTimer=null}
  const video=$("adVideo");video.pause();video.removeAttribute("src");video.load();
  $("adPlayer").hidden=true;mediaVisible=false;
}
function nextMedia(){if(!mediaVisible||!mediaItems.length)return;mediaIndex=(mediaIndex+1)%mediaItems.length;playMedia()}
function playMedia(){
  if(!mediaVisible||!mediaItems.length)return;
  if(mediaTimer){clearTimeout(mediaTimer);mediaTimer=null}
  const item=mediaItems[mediaIndex],image=$("adImage"),video=$("adVideo");
  image.hidden=item.mediaType!=="IMAGE";video.hidden=item.mediaType!=="VIDEO";
  $("adTitle").textContent=item.title||"Bersama menjaga lingkungan";
  $("adDots").innerHTML=mediaItems.map((_,index)=>`<i class="${index===mediaIndex?"active":""}"></i>`).join("");
  if(item.mediaType==="VIDEO"){image.removeAttribute("src");video.src=item.url;video.currentTime=0;video.onended=nextMedia;video.onerror=nextMedia;video.play().catch(()=>{mediaTimer=setTimeout(nextMedia,3000)})}
  else{video.pause();video.removeAttribute("src");image.src=item.url;image.onerror=nextMedia;mediaTimer=setTimeout(nextMedia,Math.max(3,Number(item.durationSeconds||8))*1000)}
}
function renderMedia(media,show){
  const items=media?.enabled&&Array.isArray(media.items)?media.items:[];
  if(!show||!items.length){if(mediaVisible)stopMedia();return}
  const changed=mediaVersion!==String(media.version||"");
  mediaItems=items;
  if(changed){mediaVersion=String(media.version||"");mediaIndex=0}
  if(!mediaVisible||changed){mediaVisible=true;$("adPlayer").hidden=false;playMedia()}
}

function renderItems(session){
  const list=$("itemList"),items=session?.items||[];
  $("totalItems").textContent=session?.totalQuantity||0;
  $("totalReward").textContent=rupiah(session?.totalReward||0);
  if(!items.length){list.innerHTML='<div class="empty">Belum ada item. Masukkan sampah pertama Anda.</div>';return}
  const grouped=new Map();
  for(const item of items){
    const current=grouped.get(item.wasteTypeName)||{name:item.wasteTypeName,quantity:0,reward:0,status:item.status};
    current.quantity+=Number(item.quantity||0);current.reward+=Number(item.rewardAmount||0);current.status=item.status;grouped.set(item.wasteTypeName,current);
  }
  list.innerHTML=[...grouped.values()].map(item=>`<div class="item-row"><span class="item-icon">${/kaleng/i.test(item.name)?"🥫":"♻"}</span><div><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(label(item.status))}</small></div><b>${item.quantity} pcs</b><em>${rupiah(item.reward)}</em></div>`).join("");
}

const alertMessages={
  REVERSE_MOTION:["Percobaan menarik kembali item","Sensor mendeteksi item ditarik setelah diterima. Setoran ditandai untuk pemeriksaan."],
  ABNORMAL_ITEM_WEIGHT:["Berat item tidak wajar","Berat objek berada di luar batas aman. Item tidak dihitung sebagai setoran valid."],
  IMPOSSIBLE_ACCEPTANCE_SEQUENCE:["Urutan sensor tidak valid","Sensor penerimaan aktif tanpa item yang sedang diproses."],
  ITEM_WITHOUT_ACTIVE_SESSION:["Item tanpa sesi aktif","Chamber mendeteksi item sebelum pengguna memulai sesi."],
  CHAMBER_OPEN_WITHOUT_SESSION:["Chamber dibuka tanpa sesi","Akses ke chamber terdeteksi ketika mesin tidak memiliki sesi aktif."],
  CHAMBER_PROCESS_TIMEOUT:["Proses item melewati batas waktu","Item terlalu lama berada di chamber dan perlu diperiksa."],
  HIGH_IMPACT_DETECTED:["Benturan keras terdeteksi","Mesin masuk mode aman karena sensor mendeteksi benturan berbahaya."],
  SERVICE_PANEL_FORCED_OPEN:["Panel servis dibuka paksa","Seluruh mekanisme dihentikan dan petugas telah diberi tahu."],
  COLLECTION_DOOR_FORCED_OPEN:["Pintu kolektor dibuka paksa","Mesin diamankan untuk mencegah akses tidak sah."],
  CAMERA_OCCLUDED:["Kamera tertutup","Visibilitas kamera hilang sehingga mesin masuk mode aman."],
  CAMERA_OFFLINE:["Kamera tidak terhubung","Validasi visual tidak tersedia sehingga mesin masuk mode aman."],
  CAMERA_BLURRY:["Kamera terlalu buram","Setoran dihentikan sementara karena gambar tidak cukup jelas untuk validasi."],
  HIGH_TEMPERATURE:["Suhu mesin terlalu tinggi","Aktuator dimatikan untuk melindungi komponen. Tunggu mesin dingin dan periksa ventilasi."],
  CONTROL_LOOP_ERROR:["Controller mengalami gangguan","Operasi dihentikan untuk melindungi mesin dan pengguna."]
};

function renderSecurityAlert(alert){
  const panel=$("securityAlert");
  panel.hidden=!alert;
  if(!alert)return null;
  const content=alertMessages[alert.reason]||[label(alert.reason),"Aktivitas tidak normal terdeteksi dan telah dicatat untuk pemeriksaan."];
  const critical=alert.severity==="CRITICAL";
  panel.classList.toggle("critical",critical);
  panel.classList.toggle("warning",!critical);
  $("alertIcon").textContent=critical?"!!":"!";
  const categories={VANDALISM:"Vandalisme - mesin diamankan",FRAUD:"Potensi fraud terdeteksi",SENSOR:"Gangguan validasi sensor",SAFETY:"Proteksi keselamatan",SYSTEM:"Gangguan sistem"};
  $("alertCategory").textContent=categories[alert.category]||(critical?"Mesin diamankan":"Peringatan mesin");
  $("alertTitle").textContent=content[0];
  $("alertMessage").textContent=content[1];
  $("alertTime").textContent=alert.occurredAt?new Date(alert.occurredAt).toLocaleTimeString("id-ID",{hour:"2-digit",minute:"2-digit",second:"2-digit"}):"";
  return content;
}

function render(d){
  const sensors=d.sensors,server=d.serverStatus,session=d.session;
  const app=document.querySelector(".app");
  app.classList.toggle("has-session",Boolean(session));
  app.classList.toggle("has-alert",Boolean(d.alert));
  const showMedia=Boolean(d.runtimeState==="IDLE"&&!session&&!d.alert&&d.media?.enabled&&d.media?.items?.length);
  app.classList.toggle("has-media",showMedia);renderMedia(d.media,showMedia);
  const activeAlert=renderSecurityAlert(d.alert);
  $("machineCode").textContent=d.machineCode;$("machineName").textContent=d.machineName;
  $("runtimeState").textContent=label(d.runtimeState);$("fillValue").textContent=sensors.fill_percent+"%";$("fillBar").style.width=sensors.fill_percent+"%";
  $("chamber").textContent=sensors.chamber_open?"Terbuka":"Tertutup";$("camera").textContent=d.camera.blurry||sensors.camera_blurry?"Buram":d.camera.online||sensors.camera_online?"Aktif":"Gangguan";
  $("temperature").textContent=Number(sensors.temperature_c).toFixed(1)+"°C";$("queue").textContent=server.queueDepth;
  $("network").classList.toggle("online",server.online);$("network").querySelector("span").textContent=server.online?"Server terhubung":"Mode offline lokal";
  $("simulatorLauncher").hidden=d.simulation?.available!==true;
  $("sessionSummary").hidden=!session;$("userName").textContent=session?.userName||"Pengguna ReLoop";renderItems(session);

  const timeout=session?.timeoutAt?new Date(session.timeoutAt).getTime()-Date.now():0;
  const seconds=Math.max(0,Math.ceil(timeout/1000));
  $("countdown").textContent=session?`${String(Math.floor(seconds/60)).padStart(2,"0")}:${String(seconds%60).padStart(2,"0")}`:"--:--";

  const showQr=Boolean(d.display?.qrDataUrl&&!d.activeSession&&d.runtimeState==="IDLE"&&!d.alert);
  $("visual").classList.toggle("has-qr",showQr);$("visual").classList.toggle("alert",Boolean(activeAlert)||["SAFE_STATE","ERROR"].includes(d.runtimeState));
  $("qr").src=showQr?d.display.qrDataUrl:"";
  const views={
    IDLE:["Mesin siap","Scan QR untuk membuka sesi","QR diperbarui otomatis"],
    SESSION_ACTIVE:["Sesi aktif","Masukkan satu item","Total dan reward tampil langsung"],
    PROCESSING:["Memeriksa item","Mohon tunggu","Sensor sedang memvalidasi material"],
    SYNC_PENDING:["Menyinkronkan","Data tersimpan aman","Menunggu koneksi server"],
    FULL:["Mesin penuh","Gunakan mesin lain","Petugas pickup telah diberi tahu"],
    SAFE_STATE:["Mesin diamankan","Operasi dihentikan",d.safeReason||"Petugas telah diberi tahu"],
    ERROR:["Terjadi gangguan","Mesin tidak menerima setoran","Hubungi petugas"]
  };
  const view=views[d.runtimeState]||["Menyiapkan","Mohon tunggu","Controller sedang dimulai"];
  const alertKickers={VANDALISM:"Mesin diamankan",FRAUD:"Pemeriksaan keamanan",SENSOR:"Gangguan sensor",SAFETY:"Proteksi keselamatan",SYSTEM:"Gangguan sistem"};
  const displayView=activeAlert?[alertKickers[d.alert.category]||(d.alert.severity==="CRITICAL"?"Mesin diamankan":"Peringatan mesin"),activeAlert[0],activeAlert[1]]:view;
  $("visualIcon").textContent=activeAlert?"!":"♻";
  $("visualKicker").textContent=displayView[0];$("visualTitle").textContent=showQr?"Scan untuk mulai":displayView[1];$("visualText").textContent=showQr?"Buka aplikasi ReLoop dan arahkan kamera ke QR":displayView[2];
  $("headline").textContent=activeAlert?activeAlert[0]:(session?`${session.totalQuantity||0} item sudah masuk.`:"Scan QR untuk mulai menyetor.");
  $("message").textContent=activeAlert?activeAlert[1]:(session?`Reward sementara ${rupiah(session.totalReward)}. Masukkan item berikutnya atau tekan Selesai di HP.`:"Setorkan botol atau kaleng satu per satu dan lihat reward bertambah langsung.");
  $("eyebrow").textContent=activeAlert?(d.alert.category==="VANDALISM"?"Peringatan vandalisme":d.alert.category==="FRAUD"?"Peringatan fraud":"Peringatan operasional"):(session?"Setoran berlangsung":"Reverse vending machine");
  $("stepScan").classList.toggle("active",!session);$("stepDeposit").classList.toggle("active",Boolean(session));$("stepReward").classList.toggle("active",Boolean(session?.totalQuantity));

  if($("maintenanceDialog").open){
    $("diagnostic").textContent=JSON.stringify(d,null,2);
    const simulation=d.simulation||{};
    $("simulatorPanel").hidden=simulation.available===false;
    const last=simulation.lastResult;
    $("simulationStatus").textContent=simulation.error?"Gagal: "+simulation.error:simulation.running?"Menjalankan "+label(simulation.scenario):last?.status==="COMPLETED"?"Selesai: "+label(last.scenario):"Siap";
    document.querySelectorAll(".scenario").forEach(button=>{
      const needsSession=button.dataset.session==="true";
      button.disabled=Boolean(simulation.running)||(needsSession&&!d.activeSession);
      button.title=needsSession&&!d.activeSession?"Scan QR dan mulai sesi pengguna terlebih dahulu":"";
    });
  }
}

async function refresh(){try{const response=await fetch("/api/state",{cache:"no-store"});render(await response.json())}catch{$("network").querySelector("span").textContent="Controller terputus"}}
async function loginMaintenance(pin){const response=await fetch("/api/maintenance/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({pin})});const data=await response.json();if(!response.ok)throw new Error("PIN salah");maintenanceToken=data.token;sessionStorage.setItem("rvmMaintenanceToken",data.token)}
async function command(command,data={}){const response=await fetch("/api/maintenance/command",{method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+maintenanceToken},body:JSON.stringify({command,...data})});if(response.status===401){maintenanceToken="";sessionStorage.removeItem("rvmMaintenanceToken");$("maintenanceDialog").close();return}const result=await response.json();if(!response.ok){$("simulationStatus").textContent=result.error||"Perintah gagal";return}render(result)}
function openMaintenance(){if(maintenanceToken){$("maintenanceDialog").showModal();return}$("pinDialog").showModal();$("pin").focus()}
$("pinForm").addEventListener("submit",async event=>{event.preventDefault();try{await loginMaintenance($("pin").value);$("pinDialog").close();$("pin").value="";$("pinError").textContent="";$("maintenanceDialog").showModal()}catch(error){$("pinError").textContent=error.message}});
$("closeMaintenance").addEventListener("click",()=>$("maintenanceDialog").close());
$("simulatorLauncher").addEventListener("click",openMaintenance);
document.querySelectorAll("[data-command]").forEach(button=>button.addEventListener("click",()=>{const data={};for(const [key,value] of Object.entries(button.dataset)){if(key!=="command")data[key]=value==="true"?true:value==="false"?false:value}command(button.dataset.command,data)}));
addEventListener("keydown",event=>{if(event.ctrlKey&&event.altKey&&event.shiftKey&&event.code==="KeyR"){event.preventDefault();openMaintenance()}});
refresh();setInterval(refresh,1000);
