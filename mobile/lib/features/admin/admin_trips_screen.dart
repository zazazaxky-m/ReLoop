import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/api_client.dart';
import '../../shared/widgets/reloop_card.dart';
import '../../shared/widgets/reloop_button.dart';
import '../../shared/widgets/status_badge.dart';
import '../../shared/widgets/skeleton_loading.dart';
import '../../theme/colors.dart';
import 'admin_shell.dart';

class AdminTripsScreen extends StatefulWidget {
  const AdminTripsScreen({super.key});
  @override
  State<AdminTripsScreen> createState() => _AdminTripsScreenState();
}

class _AdminTripsScreenState extends State<AdminTripsScreen> {
  List<dynamic> _trips = [];
  List<dynamic> _campaigns = [];
  List<dynamic> _travelAgents = [];
  List<dynamic> _wasteTypes = [];
  bool _isLoading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() { _isLoading = true; _error = null; });
    try {
      final api = context.read<ApiClient>();
      final results = await Future.wait([
        api.get('/api/trips'),
        api.get('/api/campaigns'),
        api.get('/api/travel-agents'),
        api.get('/api/waste-types'),
      ]);
      setState(() {
        _trips = ((results[0].data as Map)['trips'] as List?)?.cast<dynamic>() ?? [];
        _campaigns = ((results[1].data as Map)['campaigns'] as List?)?.cast<dynamic>() ?? [];
        _travelAgents = ((results[2].data as Map)['agents'] as List?)?.cast<dynamic>() ?? [];
        _wasteTypes = ((results[3].data as Map)['wasteTypes'] as List?)?.cast<dynamic>() ?? [];
        _isLoading = false;
      });
    } catch (e) {
      setState(() { _error = ApiClient.getErrorMessage(e); _isLoading = false; });
    }
  }

  void _showError(String msg) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg), backgroundColor: ReLoopColors.danger));
  }

  void _showSuccess(String msg) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg), backgroundColor: ReLoopColors.success));
  }

  Future<void> _createTrip() async {
    String? campaignId;
    String? travelAgentId;
    final invitedTravelAgents = _travelAgents.where((agent) {
      final a = agent as Map<String, dynamic>;
      return (a['organizationStatus'] as String? ?? 'PENDING') == 'INVITED';
    }).toList();
    final groupCtrl = TextEditingController();
    final leaderCtrl = TextEditingController();
    final contactCtrl = TextEditingController();
    final agentCtrl = TextEditingController();
    final countCtrl = TextEditingController(text: '1');

    final result = await showDialog<Map<String, dynamic>>(
      context: context,
      builder: (ctx) => StatefulBuilder(builder: (ctx, setSt) => AlertDialog(
        title: const Text('Buat Trip Baru'),
        content: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, children: [
          DropdownButtonFormField<String>(initialValue: campaignId, isExpanded: true, decoration: const InputDecoration(labelText: 'Campaign'),
            items: [_ddNull('Pilih campaign...'), ..._campaigns.map((c) => DropdownMenuItem(value: c['id'] as String? ?? '', child: Text((c['name'] as String?) ?? '')))],
            onChanged: (v) => setSt(() => campaignId = v)),
          const SizedBox(height: 10),
          DropdownButtonFormField<String>(
            initialValue: travelAgentId,
            isExpanded: true,
            decoration: const InputDecoration(labelText: 'Travel Agent'),
            items: [
              _ddNull('Tanpa travel agent'),
              ...invitedTravelAgents.map((agent) {
                final a = agent as Map<String, dynamic>;
                final orgStatus = a['organizationStatus'] as String? ?? 'PENDING';
                return DropdownMenuItem(
                  value: a['id'] as String? ?? '',
                  child: Text('${a['name'] ?? '-'} (${_travelAgentStatusLabel(orgStatus)})'),
                );
              }),
            ],
            onChanged: (v) => setSt(() => travelAgentId = v),
          ),
          if (invitedTravelAgents.isEmpty)
            const Padding(
              padding: EdgeInsets.only(top: 6),
              child: Align(
                alignment: Alignment.centerLeft,
                child: Text(
                  'Belum ada travel agent berstatus invited.',
                  style: TextStyle(fontSize: 12, color: ReLoopColors.mutedSoft),
                ),
              ),
            ),
          const SizedBox(height: 10),
          TextField(controller: groupCtrl, decoration: const InputDecoration(labelText: 'Nama Grup')),
          const SizedBox(height: 10),
          TextField(controller: leaderCtrl, decoration: const InputDecoration(labelText: 'Nama Ketua')),
          const SizedBox(height: 10),
          TextField(controller: contactCtrl, decoration: const InputDecoration(labelText: 'Kontak Ketua')),
          const SizedBox(height: 10),
          TextField(
            controller: agentCtrl,
            decoration: InputDecoration(
              labelText: travelAgentId == null ? 'Nama Travel Agent Manual' : 'Nama Travel Agent Manual',
              helperText: travelAgentId == null
                  ? 'Opsional bila agen belum ada di daftar'
                  : 'Kosongkan agar nama mengikuti agen terpilih',
            ),
          ),
          const SizedBox(height: 10),
          TextField(controller: countCtrl, decoration: const InputDecoration(labelText: 'Jumlah Peserta'), keyboardType: TextInputType.number),
        ])),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Batal')),
          TextButton(onPressed: () => Navigator.pop(ctx, {
            'campaignId': campaignId,
            'travelAgentId': travelAgentId,
            'groupName': groupCtrl.text.trim().isEmpty ? null : groupCtrl.text.trim(),
            'leaderName': leaderCtrl.text.trim().isEmpty ? null : leaderCtrl.text.trim(),
            'leaderContact': contactCtrl.text.trim().isEmpty ? null : contactCtrl.text.trim(),
            'travelAgentName': travelAgentId == null && agentCtrl.text.trim().isNotEmpty ? agentCtrl.text.trim() : null,
            'participantCount': int.tryParse(countCtrl.text) ?? 1,
          }), child: const Text('Buat')),
        ],
      )),
    );
    if (result == null || result['campaignId'] == null || !mounted) return;
    try {
      await context.read<ApiClient>().post('/api/trips', data: result);
      await _load();
      _showSuccess('Trip berhasil dibuat');
    } catch (e) { if (mounted) _showError(ApiClient.getErrorMessage(e)); }
  }

  Future<void> _issueBags(String tripId) async {
    final countCtrl = TextEditingController(text: '10');
    String? wasteTypeId;
    final result = await showDialog<Map<String, dynamic>>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setSt) => AlertDialog(
          title: const Text('Bagikan Kantong'),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextField(
                  controller: countCtrl,
                  decoration: const InputDecoration(labelText: 'Jumlah kantong'),
                  keyboardType: TextInputType.number,
                ),
                const SizedBox(height: 10),
                DropdownButtonFormField<String>(
                  initialValue: wasteTypeId,
                  isExpanded: true,
                  decoration: const InputDecoration(labelText: 'Jenis Sampah'),
                  items: [
                    _ddNull('Semua jenis / belum ditentukan'),
                    ..._wasteTypes.map((wt) {
                      final item = wt as Map<String, dynamic>;
                      return DropdownMenuItem(
                        value: item['id'] as String? ?? '',
                        child: Text(item['name'] as String? ?? ''),
                      );
                    }),
                  ],
                  onChanged: (v) => setSt(() => wasteTypeId = v),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Batal')),
            TextButton(
              onPressed: () => Navigator.pop(ctx, {
                'bagCount': int.tryParse(countCtrl.text) ?? 0,
                'wasteTypeId': wasteTypeId,
              }),
              child: const Text('Bagikan'),
            ),
          ],
        ),
      ),
    );
    final count = (result?['bagCount'] as int?) ?? 0;
    if (count <= 0 || !mounted) return;
    try {
      final api = context.read<ApiClient>();
      final res = await api.post('/api/trash-bags', data: {
        'tripId': tripId,
        'bagCount': count,
        if ((result?['wasteTypeId'] as String?)?.isNotEmpty == true) 'wasteTypeId': result!['wasteTypeId'],
      });
      final data = res.data as Map<String, dynamic>;
      final bagCount = (data['bags'] as List?)?.length ?? 0;
      await _load();
      _showSuccess('$bagCount kantong berhasil dibuat');
    } catch (e) { if (mounted) _showError(ApiClient.getErrorMessage(e)); }
  }

  Future<void> _validateBag(String tripId) async {
    final qrCtrl = TextEditingController();
    String stage = 'CHECK_OUT';
    String condition = 'GOOD';
    bool appCompleted = false;
    final returnedCtrl = TextEditingController(text: '0');
    final weightCtrl = TextEditingController();
    final noteCtrl = TextEditingController();

    final result = await showDialog<Map<String, dynamic>>(
      context: context,
      builder: (ctx) => StatefulBuilder(builder: (ctx, setSt) => AlertDialog(
        title: const Text('Validasi Kantong'),
        content: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, children: [
          DropdownButtonFormField<String>(
            initialValue: stage,
            isExpanded: true,
            decoration: const InputDecoration(labelText: 'Tahap Validasi'),
            items: const [
              DropdownMenuItem(value: 'CHECK_IN', child: Text('Check In')),
              DropdownMenuItem(value: 'CHECK_OUT', child: Text('Check Out')),
            ],
            onChanged: (v) => setSt(() => stage = v ?? 'CHECK_OUT'),
          ),
          const SizedBox(height: 10),
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            title: const Text('Proses aplikasi selesai'),
            subtitle: const Text('Aktifkan jika seluruh alur aplikasi sudah diselesaikan'),
            value: appCompleted,
            onChanged: (value) => setSt(() => appCompleted = value),
          ),
          const SizedBox(height: 10),
          TextField(controller: qrCtrl, decoration: const InputDecoration(labelText: 'Kode QR Kantong', hintText: 'wajib')),
          const SizedBox(height: 10),
          if (stage == 'CHECK_OUT') ...[
            DropdownButtonFormField<String>(initialValue: condition, isExpanded: true, decoration: const InputDecoration(labelText: 'Kondisi'),
              items: const [
                DropdownMenuItem(value: 'GOOD', child: Text('Baik')),
                DropdownMenuItem(value: 'PARTIAL', child: Text('Sebagian')),
                DropdownMenuItem(value: 'POOR', child: Text('Rusak')),
                DropdownMenuItem(value: 'NOT_RETURNED', child: Text('Tidak Dikembalikan')),
              ],
              onChanged: (v) => setSt(() => condition = v ?? 'GOOD')),
            const SizedBox(height: 10),
            TextField(controller: returnedCtrl, decoration: const InputDecoration(labelText: 'Jumlah dikembalikan'), keyboardType: TextInputType.number),
            const SizedBox(height: 10),
            TextField(controller: weightCtrl, decoration: const InputDecoration(labelText: 'Berat aktual (kg)'), keyboardType: TextInputType.number),
          ],
          const SizedBox(height: 10),
          TextField(controller: noteCtrl, decoration: const InputDecoration(labelText: 'Catatan'), maxLines: 2),
        ])),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Batal')),
          TextButton(onPressed: () => Navigator.pop(ctx, {
            'tripId': tripId,
            'validationStage': stage,
            'appCompleted': appCompleted,
            'bagQrCode': qrCtrl.text.trim(),
            if (stage == 'CHECK_OUT') 'conditionStatus': condition,
            if (stage == 'CHECK_OUT') 'returnedBagCount': int.tryParse(returnedCtrl.text) ?? 0,
            if (stage == 'CHECK_OUT' && weightCtrl.text.trim().isNotEmpty) 'actualWeightKg': double.tryParse(weightCtrl.text),
            'notes': noteCtrl.text.trim().isEmpty ? null : noteCtrl.text.trim(),
          }), child: const Text('Validasi')),
        ],
      )),
    );
    if (result == null || !mounted) return;
    try {
      await context.read<ApiClient>().post('/api/manual-validations', data: result);
      await _load();
      _showSuccess('Validasi berhasil');
    } catch (e) { if (mounted) _showError(ApiClient.getErrorMessage(e)); }
  }

  @override
  Widget build(BuildContext context) {
    return AdminShell(title: 'Trip / Trash Bag', child: RefreshIndicator(onRefresh: _load, child: _buildBody()));
  }

  Widget _buildBody() {
    if (_isLoading) return ListView(padding: const EdgeInsets.all(16), children: const [SkeletonListTile(), SizedBox(height: 8), SkeletonListTile()]);
    if (_error != null) {
      return Center(child: Column(mainAxisSize: MainAxisSize.min, children: [
        const Icon(Icons.cloud_off, size: 48, color: ReLoopColors.mutedSoft), const SizedBox(height: 12),
        Text(_error ?? '', style: const TextStyle(color: ReLoopColors.muted)),
        TextButton(onPressed: _load, child: const Text('Coba Lagi')),
      ]));
    }
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        ReLoopButton(label: 'Buat Trip', icon: Icons.add, variant: ReLoopButtonVariant.primary, onPressed: _createTrip),
        const SizedBox(height: 16),
        if (_trips.isEmpty)
          SizedBox(height: 120, child: Center(child: Text('Belum ada trip.', style: const TextStyle(color: ReLoopColors.mutedSoft))))
        else
          ..._trips.map((t) {
            final trip = t as Map<String, dynamic>;
            final campaign = trip['campaign'] as Map<String, dynamic>?;
            final status = (trip['status'] as String?) ?? 'PLANNED';
            final complianceStatus = trip['complianceStatus'] as String?;
            final bags = (trip['_count']?['bagAssignments'] as num?)?.toInt() ?? 0;
            final validations = (trip['_count']?['validations'] as num?)?.toInt() ?? 0;
            final participants = (trip['participantCount'] as num?)?.toInt() ?? 0;
            final leader = trip['leaderName'] as String?;
            final travelAgent = trip['travelAgent'] as Map<String, dynamic>?;
            final travelAgentName = (travelAgent?['name'] as String?) ?? (trip['travelAgentName'] as String?);
            final id = trip['id'] as String? ?? '';

            return Padding(padding: const EdgeInsets.only(bottom: 8), child: ReLoopCard(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [
                Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text((trip['groupName'] as String?) ?? 'Trip #${trip['id']}', style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14, color: ReLoopColors.foreground)),
                  if (campaign != null) Text(campaign['name'] as String? ?? '', style: const TextStyle(fontSize: 11, color: ReLoopColors.mutedSoft)),
                ])),
                StatusBadge(statusKey: status),
              ]),
              const SizedBox(height: 6),
              Wrap(spacing: 6, runSpacing: 4, children: [
                _chip('$participants peserta'),
                if (leader != null) _chip('Ketua: $leader'),
                if (travelAgentName != null && travelAgentName.isNotEmpty) _chip('TA: $travelAgentName'),
                _chip('$bags kantong'),
                if (validations > 0) _chip('$validations validasi'),
                if (complianceStatus != null && complianceStatus.isNotEmpty) _chip(_complianceLabel(complianceStatus)),
              ]),
              const SizedBox(height: 8),
              Row(mainAxisAlignment: MainAxisAlignment.end, children: [
                ReLoopButton(label: 'Bagikan Kantong', variant: ReLoopButtonVariant.outline, size: ReLoopButtonSize.sm, expanded: false, onPressed: () => _issueBags(id)),
                const SizedBox(width: 8),
                ReLoopButton(label: 'Validasi', variant: ReLoopButtonVariant.primary, size: ReLoopButtonSize.sm, expanded: false, onPressed: () => _validateBag(id)),
              ]),
            ])));
          }),
        const SizedBox(height: 80),
      ],
    );
  }

  Widget _chip(String label) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
    decoration: BoxDecoration(color: ReLoopColors.background, borderRadius: BorderRadius.circular(6)),
    child: Text(label, style: const TextStyle(fontSize: 10, color: ReLoopColors.muted, fontWeight: FontWeight.w500)),
  );

  DropdownMenuItem<String> _ddNull(String label) => DropdownMenuItem<String>(value: null, child: Text(label, style: const TextStyle(color: ReLoopColors.mutedSoft)));

  String _travelAgentStatusLabel(String status) {
    switch (status) {
      case 'INVITED':
        return 'Terhubung';
      case 'PENDING':
        return 'Pending';
      default:
        return status;
    }
  }

  String _complianceLabel(String status) {
    switch (status) {
      case 'NOT_STARTED':
        return 'Belum mulai';
      case 'CHECKED_IN':
        return 'Check in';
      case 'COMPLIANT':
        return 'Compliant';
      case 'NEEDS_REVIEW':
        return 'Perlu review';
      case 'NON_COMPLIANT':
        return 'Non-compliant';
      default:
        return status;
    }
  }
}
