import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import 'package:share_plus/share_plus.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../core/api_client.dart';
import '../../services/analytics_service.dart';
import '../../shared/widgets/bag_qr_scanner.dart';
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
    setState(() {
      _isLoading = true;
      _error = null;
    });
    try {
      final api = context.read<ApiClient>();
      final results = await Future.wait([
        api.get('/api/trips'),
        api.get('/api/campaigns'),
        api.get('/api/travel-agents'),
        api.get('/api/waste-types'),
      ]);
      setState(() {
        _trips =
            ((results[0].data as Map)['trips'] as List?)?.cast<dynamic>() ?? [];
        _campaigns =
            ((results[1].data as Map)['campaigns'] as List?)?.cast<dynamic>() ??
            [];
        _travelAgents =
            ((results[2].data as Map)['agents'] as List?)?.cast<dynamic>() ??
            [];
        _wasteTypes =
            ((results[3].data as Map)['wasteTypes'] as List?)
                ?.cast<dynamic>() ??
            [];
        _isLoading = false;
      });
    } catch (e) {
      setState(() {
        _error = ApiClient.getErrorMessage(e);
        _isLoading = false;
      });
    }
  }

  void _showError(String msg) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(msg), backgroundColor: ReLoopColors.danger),
    );
  }

  void _showSuccess(String msg) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(msg), backgroundColor: ReLoopColors.success),
    );
  }

  Future<void> _createTrip() async {
    String? campaignId;
    String? travelAgentId;
    final tripCampaigns = _campaigns.where((c) {
      final item = c as Map<String, dynamic>;
      final type = item['campaignType'] as String? ?? '';
      final status = item['status'] as String? ?? '';
      return (type == 'TRASH_BAG' || type == 'TOURISM_PROGRAM') && status == 'ACTIVE';
    }).toList();
    final invitedTravelAgents = _travelAgents.where((agent) {
      final a = agent as Map<String, dynamic>;
      return (a['organizationStatus'] as String? ?? 'PENDING') == 'INVITED';
    }).toList();
    final groupCtrl = TextEditingController();
    final leaderCtrl = TextEditingController();
    final contactCtrl = TextEditingController();
    final emailCtrl = TextEditingController();
    final countCtrl = TextEditingController(text: '1');

    if (tripCampaigns.isEmpty) {
      _showError(
        'Belum ada campaign ACTIVE tipe Trash Bag / Program Wisata. Aktifkan campaign dulu.',
      );
      return;
    }

    final result = await showDialog<Map<String, dynamic>>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setSt) {
          final selected = tripCampaigns.cast<Map<String, dynamic>>().where((c) => c['id'] == campaignId).firstOrNull;
          final agentRequired = (selected?['campaignType'] as String?) == 'TOURISM_PROGRAM';
          final moneyReward = (selected?['rewardMode'] as String?) == 'MONEY_REWARD';
          return AlertDialog(
            title: Text('Buat Trip Baru'),
            content: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  DropdownButtonFormField<String>(
                    initialValue: campaignId,
                    isExpanded: true,
                    decoration: const InputDecoration(
                      labelText: 'Campaign',
                      helperText: 'Hanya campaign ACTIVE Trash Bag / Wisata',
                    ),
                    items: [
                      _ddNull('Pilih campaign...'),
                      ...tripCampaigns.map(
                        (c) {
                          final item = c as Map<String, dynamic>;
                          final type = item['campaignType'] as String? ?? '';
                          return DropdownMenuItem(
                            value: item['id'] as String? ?? '',
                            child: Text(
                              '${item['name'] ?? '-'}${type == 'TOURISM_PROGRAM' ? ' · Wisata' : ' · Trash Bag'}',
                            ),
                          );
                        },
                      ),
                    ],
                    onChanged: (v) => setSt(() {
                      campaignId = v;
                      travelAgentId = null;
                    }),
                  ),
                  const SizedBox(height: 10),
                  DropdownButtonFormField<String>(
                    initialValue: travelAgentId,
                    isExpanded: true,
                    decoration: InputDecoration(
                      labelText: 'Travel Agent',
                      helperText: agentRequired
                          ? 'Wajib untuk Program Wisata'
                          : 'Opsional untuk Trash Bag',
                    ),
                    items: [
                      _ddNull(agentRequired ? 'Pilih travel agent...' : 'Tanpa travel agent'),
                      ...invitedTravelAgents.map((agent) {
                        final a = agent as Map<String, dynamic>;
                        return DropdownMenuItem(
                          value: a['id'] as String? ?? '',
                          child: Text('${a['name'] ?? '-'} (Terhubung)'),
                        );
                      }),
                    ],
                    onChanged: (v) => setSt(() => travelAgentId = v),
                  ),
                  if (agentRequired && invitedTravelAgents.isEmpty)
                    Padding(
                      padding: const EdgeInsets.only(top: 6),
                      child: Align(
                        alignment: Alignment.centerLeft,
                        child: Text(
                          'Belum ada travel agent berstatus invited.',
                          style: TextStyle(
                            fontSize: 12,
                            color: context.reloopMutedSoft,
                          ),
                        ),
                      ),
                    ),
                  const SizedBox(height: 10),
                  TextField(
                    controller: groupCtrl,
                    decoration: const InputDecoration(labelText: 'Nama Grup'),
                  ),
                  const SizedBox(height: 10),
                  TextField(
                    controller: leaderCtrl,
                    decoration: const InputDecoration(labelText: 'Nama Ketua'),
                  ),
                  const SizedBox(height: 10),
                  TextField(
                    controller: contactCtrl,
                    decoration: const InputDecoration(labelText: 'Kontak Ketua'),
                  ),
                  const SizedBox(height: 10),
                  TextField(
                    controller: emailCtrl,
                    decoration: InputDecoration(
                      labelText: moneyReward
                          ? 'Email User Penerima Reward'
                          : 'Email User (opsional)',
                      helperText: moneyReward
                          ? 'Wajib untuk campaign reward uang'
                          : 'Opsional (campaign compliance-only)',
                    ),
                    keyboardType: TextInputType.emailAddress,
                  ),
                  const SizedBox(height: 10),
                  TextField(
                    controller: countCtrl,
                    decoration: const InputDecoration(
                      labelText: 'Jumlah Peserta',
                    ),
                    keyboardType: TextInputType.number,
                  ),
                ],
              ),
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(ctx),
                child: Text('Batal'),
              ),
              TextButton(
                onPressed: () {
                  if (campaignId == null) return;
                  if (agentRequired && (travelAgentId == null || travelAgentId!.isEmpty)) {
                    return;
                  }
                  if (moneyReward && emailCtrl.text.trim().isEmpty) {
                    return;
                  }
                  Navigator.pop(ctx, {
                    'campaignId': campaignId,
                    'travelAgentId': travelAgentId,
                    'groupName': groupCtrl.text.trim().isEmpty
                        ? null
                        : groupCtrl.text.trim(),
                    'leaderName': leaderCtrl.text.trim().isEmpty
                        ? null
                        : leaderCtrl.text.trim(),
                    'leaderContact': contactCtrl.text.trim().isEmpty
                        ? null
                        : contactCtrl.text.trim(),
                    if (emailCtrl.text.trim().isNotEmpty)
                      'userEmail': emailCtrl.text.trim(),
                    'participantCount': int.tryParse(countCtrl.text) ?? 1,
                  });
                },
                child: Text('Buat'),
              ),
            ],
          );
        },
      ),
    );
    if (result == null || result['campaignId'] == null || !mounted) return;
    try {
      await context.read<ApiClient>().post('/api/trips', data: result);
      await _load();
      _showSuccess('Trip berhasil dibuat');
    } catch (e) {
      if (mounted) _showError(ApiClient.getErrorMessage(e));
    }
  }

  Future<void> _issueBags(String tripId) async {
    final countCtrl = TextEditingController(text: '10');
    String? wasteTypeId;
    final result = await showDialog<Map<String, dynamic>>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setSt) => AlertDialog(
          title: Text('Bagikan Kantong'),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextField(
                  controller: countCtrl,
                  decoration: const InputDecoration(
                    labelText: 'Jumlah kantong',
                    helperText: 'Maksimal 200',
                  ),
                  keyboardType: TextInputType.number,
                  inputFormatters: [FilteringTextInputFormatter.digitsOnly],
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
            TextButton(
              onPressed: () => Navigator.pop(ctx),
              child: Text('Batal'),
            ),
            TextButton(
              onPressed: () {
                final count = int.tryParse(countCtrl.text) ?? 0;
                if (count < 1 || count > 200) {
                  ScaffoldMessenger.of(ctx).showSnackBar(
                    const SnackBar(content: Text('Jumlah harus 1–200')),
                  );
                  return;
                }
                Navigator.pop(ctx, {
                  'bagCount': count,
                  'wasteTypeId': wasteTypeId,
                });
              },
              child: Text('Bagikan'),
            ),
          ],
        ),
      ),
    );
    final count = (result?['bagCount'] as int?) ?? 0;
    if (count <= 0 || !mounted) return;
    try {
      final api = context.read<ApiClient>();
      final res = await api.post(
        '/api/trash-bags',
        data: {
          'tripId': tripId,
          'bagCount': count,
          if ((result?['wasteTypeId'] as String?)?.isNotEmpty == true)
            'wasteTypeId': result!['wasteTypeId'],
        },
      );
      final data = res.data as Map<String, dynamic>;
      final bags = (data['bags'] as List?)?.cast<dynamic>() ?? [];
      final wasteTypeName = _wasteTypes
          .cast<Map<String, dynamic>>()
          .where((wt) => wt['id'] == result?['wasteTypeId'])
          .map((wt) => wt['name'] as String?)
          .firstOrNull;
      await AnalyticsService().trackTrashBagIssue(
        wasteTypeName ?? 'unspecified',
      );
      await _load();
      if (!mounted) return;
      _showSuccess('${bags.length} kantong berhasil dibuat');
      await _showBagCodesDialog(bags);
    } catch (e) {
      if (mounted) _showError(ApiClient.getErrorMessage(e));
    }
  }

  Future<void> _viewBags(String tripId) async {
    try {
      final api = context.read<ApiClient>();
      final res = await api.get('/api/trash-bags', queryParameters: {
        'tripId': tripId,
      });
      final data = res.data as Map<String, dynamic>;
      final bags = (data['bags'] as List?)?.cast<dynamic>() ?? [];
      if (!mounted) return;
      if (bags.isEmpty) {
        _showError('Belum ada kantong untuk trip ini');
        return;
      }
      await _showBagCodesDialog(bags);
    } catch (e) {
      if (mounted) _showError(ApiClient.getErrorMessage(e));
    }
  }

  // External browser / url_launcher — not exercisable in widget tests.
  // coverage:ignore-start
  Future<void> _openPrintPage(String tripId) async {
    final base = ApiClient.baseUrl.replaceFirst(RegExp(r'/+$'), '');
    final uri = Uri.parse('$base/print/trips/$tripId');
    try {
      final ok = await launchUrl(uri, mode: LaunchMode.externalApplication);
      if (!ok && mounted) {
        _showError('Tidak bisa membuka halaman cetak');
      }
    } catch (e) {
      if (mounted) _showError('Gagal membuka cetak: $e');
    }
  }
  // coverage:ignore-end

  Future<void> _showBagCodesDialog(List<dynamic> bags) async {
    final codes = bags
        .map((b) {
          final bag = b as Map<String, dynamic>;
          return (bag['bagQrCode'] as String?) ?? '';
        })
        .where((c) => c.isNotEmpty)
        .toList();
    if (codes.isEmpty || !mounted) return;

    await showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('Kode QR Kantong (${codes.length})'),
        content: SizedBox(
          width: double.maxFinite,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                'Salin atau bagikan kode berikut untuk dicetak / ditempel di kantong fisik.',
                style: TextStyle(fontSize: 12, color: context.reloopMuted),
              ),
              const SizedBox(height: 12),
              ConstrainedBox(
                constraints: const BoxConstraints(maxHeight: 280),
                child: ListView.separated(
                  shrinkWrap: true,
                  itemCount: bags.length,
                  separatorBuilder: (_, _) => const Divider(height: 1),
                  itemBuilder: (_, i) {
                    final bag = bags[i] as Map<String, dynamic>;
                    final code = (bag['bagQrCode'] as String?) ?? '-';
                    final waste =
                        (bag['wasteType'] as Map<String, dynamic>?)?['name']
                            as String?;
                    final status = bag['status'] as String?;
                    return ListTile(
                      dense: true,
                      contentPadding: EdgeInsets.zero,
                      title: Text(
                        code,
                        style: const TextStyle(
                          fontFamily: 'monospace',
                          fontWeight: FontWeight.w600,
                          fontSize: 13,
                        ),
                      ),
                      subtitle: Text(
                        [
                          if (waste != null && waste.isNotEmpty) waste,
                          if (status != null) _bagStatusLabel(status),
                          if (status == null) 'Belum divalidasi',
                        ].join(' · '),
                        style: TextStyle(
                          fontSize: 11,
                          color: context.reloopMutedSoft,
                        ),
                      ),
                      trailing: IconButton(
                        tooltip: 'Salin',
                        icon: const Icon(Icons.copy, size: 18),
                        // Clipboard channel is flaky in widget tests.
                        // coverage:ignore-start
                        onPressed: () async {
                          await Clipboard.setData(ClipboardData(text: code));
                          if (ctx.mounted) {
                            ScaffoldMessenger.of(ctx).showSnackBar(
                              SnackBar(
                                content: Text('Disalin: $code'),
                                backgroundColor: ReLoopColors.success,
                              ),
                            );
                          }
                        },
                        // coverage:ignore-end
                      ),
                    );
                  },
                ),
              ),
            ],
          ),
        ),
        actions: [
          TextButton(
            // Clipboard channel is flaky in widget tests.
            // coverage:ignore-start
            onPressed: () async {
              await Clipboard.setData(
                ClipboardData(text: codes.join('\n')),
              );
              if (ctx.mounted) {
                ScaffoldMessenger.of(ctx).showSnackBar(
                  SnackBar(
                    content: Text('${codes.length} kode disalin'),
                    backgroundColor: ReLoopColors.success,
                  ),
                );
              }
            },
            // coverage:ignore-end
            child: Text('Salin Semua'),
          ),
          TextButton(
            // coverage:ignore-start
            onPressed: () async {
              await Share.share(
                'Kode QR Trash Bag ReLoop:\n${codes.join('\n')}',
                subject: 'Kode QR Trash Bag',
              );
            },
            // coverage:ignore-end
            child: Text('Bagikan'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: Text('Tutup'),
          ),
        ],
      ),
    );
  }

  String _bagStatusLabel(String status) {
    switch (status) {
      case 'GOOD':
        return 'Baik';
      case 'PARTIAL':
        return 'Sebagian';
      case 'POOR':
        return 'Rusak';
      case 'NOT_RETURNED':
        return 'Tidak dikembalikan';
      default:
        return status;
    }
  }

  // Bag QR scanner requires camera plugin — covered via direct Validasi flow.
  // coverage:ignore-start
  Future<void> _scanAndValidate({String? tripId}) async {
    final scanned = await scanBagQrCode(context);
    if (scanned == null || !mounted) return;

    String? resolvedTripId = tripId;
    if (resolvedTripId == null) {
      try {
        final api = context.read<ApiClient>();
        final res = await api.get(
          '/api/trash-bags',
          queryParameters: {'qrCode': scanned},
        );
        final data = res.data as Map<String, dynamic>;
        final bags = (data['bags'] as List?)?.cast<dynamic>() ?? [];
        if (bags.isEmpty) {
          _showError('QR kantong tidak ditemukan');
          return;
        }
        resolvedTripId =
            (bags.first as Map<String, dynamic>)['tripId'] as String?;
        if (resolvedTripId == null || resolvedTripId.isEmpty) {
          _showError('Trip untuk kantong ini tidak ditemukan');
          return;
        }
      } catch (e) {
        if (mounted) _showError(ApiClient.getErrorMessage(e));
        return;
      }
    }

    await _validateBag(resolvedTripId, prefillQr: scanned);
  }
  // coverage:ignore-end

  Future<void> _cancelTrip(String tripId) async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('Batalkan Trip?'),
        content: Text(
          'Trip yang dibatalkan tidak bisa divalidasi atau diterbitkan kantong baru.',
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: Text('Tidak')),
          TextButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: Text('Batalkan', style: TextStyle(color: ReLoopColors.danger)),
          ),
        ],
      ),
    );
    if (confirm != true || !mounted) return;
    try {
      await context.read<ApiClient>().patch(
        '/api/trips/$tripId',
        data: {'status': 'CANCELLED'},
      );
      await _load();
      _showSuccess('Trip dibatalkan');
    } catch (e) {
      if (mounted) _showError(ApiClient.getErrorMessage(e));
    }
  }

  Future<void> _reopenTrip(String tripId) async {
    try {
      await context.read<ApiClient>().patch(
        '/api/trips/$tripId',
        data: {'status': 'PLANNED'},
      );
      await _load();
      _showSuccess('Trip dibuka ulang');
    } catch (e) {
      if (mounted) _showError(ApiClient.getErrorMessage(e));
    }
  }

  Future<void> _validateBag(String tripId, {String? prefillQr}) async {
    List<Map<String, dynamic>> bags = [];
    try {
      final api = context.read<ApiClient>();
      final res = await api.get(
        '/api/trash-bags',
        queryParameters: {'tripId': tripId},
      );
      final data = res.data as Map<String, dynamic>;
      bags = ((data['bags'] as List?) ?? [])
          .cast<dynamic>()
          .map((b) {
            final bag = Map<String, dynamic>.from(b as Map);
            // Prefill only used from camera scan flow.
            // coverage:ignore-start
            if (prefillQr != null && bag['bagQrCode'] == prefillQr) {
              bag['status'] = bag['status'] ?? 'GOOD';
            }
            // coverage:ignore-end
            return bag;
          })
          .toList();
    } catch (e) {
      if (mounted) _showError(ApiClient.getErrorMessage(e));
      return;
    }
    if (!mounted) return;

    // Prefer CHECK_IN when trip still PLANNED; otherwise CHECK_OUT.
    Map<String, dynamic>? tripMap;
    for (final t in _trips) {
      final m = t as Map<String, dynamic>;
      if (m['id'] == tripId) {
        tripMap = m;
        break;
      }
    }
    final tripStatus = tripMap?['status'] as String? ?? 'ACTIVE';
    String stage = tripStatus == 'PLANNED' ? 'CHECK_IN' : 'CHECK_OUT';
    bool appCompleted = true;
    final noteCtrl = TextEditingController();
    final weightCtrl = TextEditingController();
    final bagStatuses = <String, String>{
      for (final b in bags)
        (b['id'] as String): (b['status'] as String?) ?? 'NOT_RETURNED',
    };
    // Prefill only used from camera scan flow.
    // coverage:ignore-start
    if (prefillQr != null) {
      for (final b in bags) {
        if (b['bagQrCode'] == prefillQr) {
          bagStatuses[b['id'] as String] = (b['status'] as String?) ?? 'GOOD';
        }
      }
    }
    // coverage:ignore-end

    final result = await showDialog<Map<String, dynamic>>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setSt) => AlertDialog(
          title: Text('Validasi Trip'),
          content: SizedBox(
            width: double.maxFinite,
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
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
                    title: Text('Proses aplikasi selesai'),
                    value: appCompleted,
                    onChanged: (value) => setSt(() => appCompleted = value),
                  ),
                  if (stage == 'CHECK_OUT') ...[
                    const SizedBox(height: 8),
                    Align(
                      alignment: Alignment.centerLeft,
                      child: Text(
                        bags.isEmpty
                            ? 'Belum ada kantong. Terbitkan dulu sebelum check-out.'
                            : 'Kondisi per kantong (${bags.length})',
                        style: TextStyle(
                          fontWeight: FontWeight.w600,
                          color: context.reloopForeground,
                        ),
                      ),
                    ),
                    const SizedBox(height: 8),
                    ...bags.map((bag) {
                      final id = bag['id'] as String;
                      final code = (bag['bagQrCode'] as String?) ?? '-';
                      return Padding(
                        padding: const EdgeInsets.only(bottom: 8),
                        child: Row(
                          children: [
                            Expanded(
                              child: Text(
                                code,
                                style: const TextStyle(
                                  fontFamily: 'monospace',
                                  fontSize: 12,
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                            ),
                            const SizedBox(width: 8),
                            SizedBox(
                              width: 140,
                              child: DropdownButtonFormField<String>(
                                initialValue: bagStatuses[id] ?? 'NOT_RETURNED',
                                isExpanded: true,
                                decoration: const InputDecoration(
                                  isDense: true,
                                  contentPadding: EdgeInsets.symmetric(
                                    horizontal: 8,
                                    vertical: 8,
                                  ),
                                ),
                                items: const [
                                  DropdownMenuItem(value: 'GOOD', child: Text('Baik')),
                                  DropdownMenuItem(value: 'PARTIAL', child: Text('Sebagian')),
                                  DropdownMenuItem(value: 'POOR', child: Text('Rusak')),
                                  DropdownMenuItem(
                                    value: 'NOT_RETURNED',
                                    child: Text('Hilang'),
                                  ),
                                ],
                                onChanged: (v) => setSt(
                                  () => bagStatuses[id] = v ?? 'NOT_RETURNED',
                                ),
                              ),
                            ),
                          ],
                        ),
                      );
                    }),
                  ],
                  const SizedBox(height: 10),
                  TextField(
                    controller: noteCtrl,
                    decoration: const InputDecoration(labelText: 'Catatan'),
                    maxLines: 2,
                  ),
                  if (stage == 'CHECK_OUT') ...[
                    const SizedBox(height: 10),
                    TextField(
                      controller: weightCtrl,
                      decoration: const InputDecoration(
                        labelText: 'Berat aktual (kg, opsional)',
                      ),
                      keyboardType: const TextInputType.numberWithOptions(
                        decimal: true,
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx), child: Text('Batal')),
            TextButton(
              onPressed: () {
                if (stage == 'CHECK_OUT' && bags.isEmpty) return;
                final weight = double.tryParse(weightCtrl.text.trim());
                Navigator.pop(ctx, {
                  'tripId': tripId,
                  'validationStage': stage,
                  'gateType': stage == 'CHECK_IN' ? 'ENTRY' : 'EXIT',
                  'appCompleted': appCompleted,
                  // coverage:ignore-start
                  if (prefillQr != null && prefillQr.isNotEmpty) 'bagQrCode': prefillQr,
                  // coverage:ignore-end
                  if (stage == 'CHECK_OUT')
                    'bags': bags
                        .map(
                          (b) => {
                            'id': b['id'],
                            'status': bagStatuses[b['id'] as String] ?? 'NOT_RETURNED',
                          },
                        )
                        .toList(),
                  if (stage == 'CHECK_OUT' && weight != null) 'actualWeightKg': weight,
                  'notes': noteCtrl.text.trim().isEmpty ? null : noteCtrl.text.trim(),
                });
              },
              child: Text('Validasi'),
            ),
          ],
        ),
      ),
    );
    if (result == null || !mounted) return;
    try {
      await context.read<ApiClient>().post(
        '/api/manual-validations',
        data: result,
      );
      await _load();
      _showSuccess('Validasi berhasil');
    } catch (e) {
      if (mounted) _showError(ApiClient.getErrorMessage(e));
    }
  }

  @override
  Widget build(BuildContext context) {
    return AdminShell(
      title: 'Trip / Trash Bag',
      child: RefreshIndicator(onRefresh: _load, child: _buildBody()),
    );
  }

  Widget _buildBody() {
    if (_isLoading) {
      return ListView(
        padding: const EdgeInsets.all(16),
        children: const [
          SkeletonListTile(),
          SizedBox(height: 8),
          SkeletonListTile(),
        ],
      );
    }
    if (_error != null) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.cloud_off, size: 48, color: context.reloopMutedSoft),
            const SizedBox(height: 12),
            Text(_error ?? '', style: TextStyle(color: context.reloopMuted)),
            TextButton(onPressed: _load, child: Text('Coba Lagi')),
          ],
        ),
      );
    }
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Row(
          children: [
            Expanded(
              child: ReLoopButton(
                label: 'Buat Trip',
                icon: Icons.add,
                variant: ReLoopButtonVariant.primary,
                onPressed: _createTrip,
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: ReLoopButton(
                label: 'Scan Kantong',
                icon: Icons.qr_code_scanner,
                variant: ReLoopButtonVariant.outline,
                onPressed: () => _scanAndValidate(), // coverage:ignore-line
              ),
            ),
          ],
        ),
        const SizedBox(height: 16),
        if (_trips.isEmpty)
          SizedBox(
            height: 120,
            child: Center(
              child: Text(
                'Belum ada trip.',
                style: TextStyle(color: context.reloopMutedSoft),
              ),
            ),
          )
        else
          ..._trips.map((t) {
            final trip = t as Map<String, dynamic>;
            final campaign = trip['campaign'] as Map<String, dynamic>?;
            final status = (trip['status'] as String?) ?? 'PLANNED';
            final complianceStatus = trip['complianceStatus'] as String?;
            final bags =
                (trip['_count']?['bagAssignments'] as num?)?.toInt() ?? 0;
            final validations =
                (trip['_count']?['validations'] as num?)?.toInt() ?? 0;
            final participants =
                (trip['participantCount'] as num?)?.toInt() ?? 0;
            final leader = trip['leaderName'] as String?;
            final travelAgent = trip['travelAgent'] as Map<String, dynamic>?;
            final travelAgentName =
                (travelAgent?['name'] as String?) ??
                (trip['travelAgentName'] as String?);
            final rewardUser = trip['user'] as Map<String, dynamic>?;
            final rewardMode = campaign?['rewardMode'] as String?;
            final id = trip['id'] as String? ?? '';
            final canOperate = status == 'PLANNED' || status == 'ACTIVE';

            return Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: ReLoopCard(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                (trip['groupName'] as String?) ??
                                    'Trip #${trip['id']}',
                                style: TextStyle(
                                  fontWeight: FontWeight.w600,
                                  fontSize: 14,
                                  color: context.reloopForeground,
                                ),
                              ),
                              if (campaign != null)
                                Text(
                                  campaign['name'] as String? ?? '',
                                  style: TextStyle(
                                    fontSize: 11,
                                    color: context.reloopMutedSoft,
                                  ),
                                ),
                            ],
                          ),
                        ),
                        StatusBadge(statusKey: status),
                      ],
                    ),
                    const SizedBox(height: 6),
                    Wrap(
                      spacing: 6,
                      runSpacing: 4,
                      children: [
                        _chip('$participants peserta'),
                        if (leader != null) _chip('Ketua: $leader'),
                        if (travelAgentName != null &&
                            travelAgentName.isNotEmpty)
                          _chip('TA: $travelAgentName'),
                        _chip('$bags kantong'),
                        if (validations > 0) _chip('$validations validasi'),
                        if (complianceStatus != null &&
                            complianceStatus.isNotEmpty)
                          _chip(_complianceLabel(complianceStatus)),
                        if (rewardUser != null && rewardMode == 'MONEY_REWARD')
                          _chip('Reward: ${rewardUser['email'] ?? rewardUser['name'] ?? 'user'}'),
                        if (rewardMode == 'MONEY_REWARD' && rewardUser == null)
                          _chip('Tanpa penerima reward'),
                      ],
                    ),
                    const SizedBox(height: 8),
                    Wrap(
                      alignment: WrapAlignment.end,
                      spacing: 8,
                      runSpacing: 8,
                      children: [
                        if (bags > 0) ...[
                          ReLoopButton(
                            label: 'Lihat QR',
                            variant: ReLoopButtonVariant.ghost,
                            size: ReLoopButtonSize.sm,
                            expanded: false,
                            onPressed: () => _viewBags(id),
                          ),
                          ReLoopButton(
                            label: 'Cetak',
                            variant: ReLoopButtonVariant.outline,
                            size: ReLoopButtonSize.sm,
                            expanded: false,
                            onPressed: () => _openPrintPage(id),
                          ),
                        ],
                        if (canOperate) ...[
                          ReLoopButton(
                            label: 'Bagikan Kantong',
                            variant: ReLoopButtonVariant.outline,
                            size: ReLoopButtonSize.sm,
                            expanded: false,
                            onPressed: () => _issueBags(id),
                          ),
                          ReLoopButton(
                            label: 'Scan',
                            variant: ReLoopButtonVariant.outline,
                            size: ReLoopButtonSize.sm,
                            expanded: false,
                            onPressed: () => _scanAndValidate(tripId: id), // coverage:ignore-line
                          ),
                          ReLoopButton(
                            label: 'Validasi',
                            variant: ReLoopButtonVariant.primary,
                            size: ReLoopButtonSize.sm,
                            expanded: false,
                            onPressed: () => _validateBag(id),
                          ),
                          ReLoopButton(
                            label: 'Batalkan',
                            variant: ReLoopButtonVariant.ghost,
                            size: ReLoopButtonSize.sm,
                            expanded: false,
                            onPressed: () => _cancelTrip(id),
                          ),
                        ],
                        if (status == 'CANCELLED')
                          ReLoopButton(
                            label: 'Buka Ulang',
                            variant: ReLoopButtonVariant.outline,
                            size: ReLoopButtonSize.sm,
                            expanded: false,
                            onPressed: () => _reopenTrip(id),
                          ),
                      ],
                    ),
                  ],
                ),
              ),
            );
          }),
        const SizedBox(height: 80),
      ],
    );
  }

  Widget _chip(String label) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
    decoration: BoxDecoration(
      color: context.reloopSurfaceSoft,
      borderRadius: BorderRadius.circular(6),
    ),
    child: Text(
      label,
      style: TextStyle(
        fontSize: 10,
        color: context.reloopMuted,
        fontWeight: FontWeight.w500,
      ),
    ),
  );

  DropdownMenuItem<String> _ddNull(String label) => DropdownMenuItem<String>(
    value: null,
    child: Text(label, style: TextStyle(color: context.reloopMutedSoft)),
  );

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
