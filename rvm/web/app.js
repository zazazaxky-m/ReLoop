const $=id=>document.getElementById(id);
let maintenanceToken=sessionStorage.getItem("rvmMaintenanceToken")||"";
function label(s){return String(s||"").replaceAll("_"," ")}
function render(d){
  const s=d.sensors,server=d.serverStatus;
  $("machineCode").textContent=d.machineCode;$("machineName").textContent=d.machineName;
  $("runtimeState").textContent=label(d.runtimeState);$("fillValue").textContent=s.fill_percent+"%";$("fillBar").style.width=s.fill_percent+"%";
  $("chamber").textContent=s.chamber_open?"Terbuka":"Tertutup";$("camera").textContent=d.camera.online||s.camera_online?"Aktif":"Gangguan";
  $("simulatorLauncher").hidden=d.simulation?.available!==true;
  $("temperature").textContent=Number(s.temperature_c).toFixed(1)+"°C";$("queue").textContent=server.queueDepth;
  $("network").classList.toggle("online",server.online);$("network").querySelector("span").textContent=server.online?"Server terhubung":"Mode offline lokal";
  const alert=["SAFE_STATE","ERROR"].includes(d.runtimeState);$("visual").classList.toggle("alert",alert);
  const showQr=Boolean(d.display?.qrDataUrl&&!d.activeSession&&d.runtimeState==="IDLE");
  $("visual").classList.toggle("has-qr",showQr);$("qr").src=showQr?d.display.qrDataUrl:"";
  const views={
    IDLE:["Scan QR untuk mulai","Chamber terkunci hingga sesi terverifikasi"],
    SESSION_ACTIVE:["Sesi aktif","Silakan masukkan satu item"],
    PROCESSING:["Memeriksa item","Jangan tarik kembali material"],
    SYNC_PENDING:["Menunggu sinkronisasi","Setoran tersimpan aman di mesin"],
    FULL:["Mesin penuh","Silakan gunakan mesin lain"],
    SAFE_STATE:["Mesin diamankan",d.safeReason||"Petugas telah diberi tahu"],
    ERROR:["Terjadi gangguan","Mesin tidak menerima setoran"]
  },v=views[d.runtimeState]||["Menyiapkan mesin","Mohon tunggu"];
  $("visualTitle").textContent=showQr?"Scan untuk mulai":v[0];$("visualText").textContent=showQr?"QR diperbarui otomatis":v[1];
  $("headline").textContent=d.activeSession?"Masukkan item satu per satu.":"Scan QR untuk mulai menyetor.";
  $("message").textContent=server.online?"Sesi dan reward akan diverifikasi secara langsung.":"Mesin tetap aman. Setoran baru menunggu koneksi server.";
  if($("maintenanceDialog").open){
    $("diagnostic").textContent=JSON.stringify(d,null,2);
    const simulation=d.simulation||{};
    $("simulatorPanel").hidden=simulation.available===false;
    $("simulationStatus").textContent=simulation.error?"Gagal: "+simulation.error:simulation.running?"Menjalankan "+label(simulation.scenario):"Siap";
    document.querySelectorAll(".scenario").forEach(button=>button.disabled=Boolean(simulation.running));
  }
}
async function refresh(){try{const r=await fetch("/api/state",{cache:"no-store"});render(await r.json())}catch{$("network").querySelector("span").textContent="Controller terputus"}}
async function loginMaintenance(pin){
  const r=await fetch("/api/maintenance/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({pin})}),d=await r.json();
  if(!r.ok)throw new Error("PIN salah");maintenanceToken=d.token;sessionStorage.setItem("rvmMaintenanceToken",d.token);
}
async function command(command,data={}){
  const r=await fetch("/api/maintenance/command",{method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+maintenanceToken},body:JSON.stringify({command,...data})});
  if(r.status===401){maintenanceToken="";sessionStorage.removeItem("rvmMaintenanceToken");$("maintenanceDialog").close();return}
  const result=await r.json();
  if(!r.ok){$("simulationStatus").textContent=result.error||"Perintah gagal";return}
  render(result);
}
function maintenanceShortcut(e){
  if(!(e.ctrlKey&&e.altKey&&e.shiftKey&&e.code==="KeyR"))return;
  e.preventDefault();if(maintenanceToken){$("maintenanceDialog").showModal();return}$("pinDialog").showModal();$("pin").focus();
}
function openMaintenance(){
  if(maintenanceToken){$("maintenanceDialog").showModal();return}
  $("pinDialog").showModal();$("pin").focus();
}
$("pinForm").addEventListener("submit",async e=>{e.preventDefault();try{await loginMaintenance($("pin").value);$("pinDialog").close();$("pin").value="";$("pinError").textContent="";$("maintenanceDialog").showModal()}catch(err){$("pinError").textContent=err.message}});
$("closeMaintenance").addEventListener("click",()=> $("maintenanceDialog").close());
$("simulatorLauncher").addEventListener("click",openMaintenance);
document.querySelectorAll("[data-command]").forEach(button=>button.addEventListener("click",()=>{const data={};for(const [k,v] of Object.entries(button.dataset)){if(k!=="command")data[k]=v==="true"?true:v==="false"?false:v}command(button.dataset.command,data)}));
addEventListener("keydown",maintenanceShortcut);refresh();setInterval(refresh,500);
