import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/api_client.dart';
import '../../shared/widgets/metric_card.dart';
import '../../shared/widgets/reloop_button.dart';
import '../../shared/widgets/reloop_card.dart';
import '../../shared/widgets/status_badge.dart';
import '../../shared/widgets/skeleton_loading.dart';
import '../../theme/colors.dart';
import 'admin_shell.dart';

class AdminTravelAgentsScreen extends StatefulWidget {
  const AdminTravelAgentsScreen({super.key});

  @override
  State<AdminTravelAgentsScreen> createState() =>
      _AdminTravelAgentsScreenState();
}

class _AdminTravelAgentsScreenState extends State<AdminTravelAgentsScreen> {
  List<dynamic> _agents = [];
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
      final res = await context.read<ApiClient>().get('/api/travel-agents');
      setState(() {
        _agents = ((res.data as Map)['agents'] as List?)?.cast<dynamic>() ?? [];
        _isLoading = false;
      });
    } catch (e) {
      setState(() {
        _error = ApiClient.getErrorMessage(e);
        _isLoading = false;
      });
    }
  }

  Future<void> _invite() async {
    final nameCtrl = TextEditingController();
    final emailCtrl = TextEditingController();
    final phoneCtrl = TextEditingController();
    final contactCtrl = TextEditingController();
    final notesCtrl = TextEditingController();

    final result = await showDialog<Map<String, String>>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('Tambah Travel Agent'),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(
                controller: nameCtrl,
                decoration: const InputDecoration(
                  labelText: 'Nama',
                  hintText: 'wajib',
                ),
              ),
              const SizedBox(height: 10),
              TextField(
                controller: emailCtrl,
                decoration: const InputDecoration(
                  labelText: 'Email',
                  hintText: 'agent@contoh.com',
                ),
                keyboardType: TextInputType.emailAddress,
              ),
              const SizedBox(height: 10),
              TextField(
                controller: contactCtrl,
                decoration: const InputDecoration(labelText: 'Kontak Person'),
              ),
              const SizedBox(height: 10),
              TextField(
                controller: phoneCtrl,
                decoration: const InputDecoration(labelText: 'Nomor HP'),
                keyboardType: TextInputType.phone,
              ),
              const SizedBox(height: 10),
              TextField(
                controller: notesCtrl,
                decoration: const InputDecoration(labelText: 'Catatan'),
                maxLines: 2,
              ),
            ],
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: Text('Batal')),
          TextButton(
            onPressed: () => Navigator.pop(ctx, {
              'name': nameCtrl.text.trim(),
              'email': emailCtrl.text.trim(),
              'contactPerson': contactCtrl.text.trim(),
              'phone': phoneCtrl.text.trim(),
              'notes': notesCtrl.text.trim(),
            }),
            child: Text('Simpan'),
          ),
        ],
      ),
    );

    if (result == null) return;
    if ((result['name']?.isEmpty ?? true) ||
        (result['email']?.isEmpty ?? true) ||
        !mounted) {
      return;
    }

    try {
      final res = await context.read<ApiClient>().post(
        '/api/travel-agents',
        data: {
          'name': result['name'],
          'email': result['email'],
          if (result['contactPerson']?.isNotEmpty ?? false)
            'contactPerson': result['contactPerson'],
          if (result['phone']?.isNotEmpty ?? false) 'phone': result['phone'],
          if (result['notes']?.isNotEmpty ?? false) 'notes': result['notes'],
        },
      );
      final invite =
          (res.data as Map<String, dynamic>)['invite'] as Map<String, dynamic>?;
      await _load();
      if (!mounted) return;
      final invited = invite?['status'] == 'INVITED';
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            invited
                ? 'Travel agent sudah punya akun dan langsung berstatus invited.'
                : 'Travel agent disimpan sebagai pending sampai email tersebut membuat akun.',
          ),
          backgroundColor: ReLoopColors.success,
        ),
      );
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(ApiClient.getErrorMessage(e)),
          backgroundColor: ReLoopColors.danger,
        ),
      );
    }
  }

  int get _invitedCount =>
      _agents.where((a) => a['organizationStatus'] == 'INVITED').length;
  int get _compliantTrips => _agents.fold<int>(
    0,
    (sum, a) => sum + ((a['compliantCount'] as num?)?.toInt() ?? 0),
  );
  int get _nonCompliantTrips => _agents.fold<int>(
    0,
    (sum, a) => sum + ((a['nonCompliantCount'] as num?)?.toInt() ?? 0),
  );

  @override
  Widget build(BuildContext context) {
    return AdminShell(
      title: 'Travel Agent',
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
            Text(_error!, style: TextStyle(color: context.reloopMuted)),
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
              child: MetricCard(
                label: 'Total Agent',
                value: _agents.length.toString(),
                icon: Icons.group_outlined,
                tone: MetricTone.blue,
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: MetricCard(
                label: 'Invited',
                value: _invitedCount.toString(),
                icon: Icons.mark_email_read_outlined,
                tone: MetricTone.green,
              ),
            ),
          ],
        ),
        const SizedBox(height: 12),
        Row(
          children: [
            Expanded(
              child: MetricCard(
                label: 'Trip Patuh',
                value: _compliantTrips.toString(),
                icon: Icons.check_circle_outline,
                tone: MetricTone.teal,
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: MetricCard(
                label: 'Tidak Patuh',
                value: _nonCompliantTrips.toString(),
                icon: Icons.warning_amber_rounded,
                tone: MetricTone.amber,
              ),
            ),
          ],
        ),
        const SizedBox(height: 16),
        ReLoopButton(
          label: 'Tambah Travel Agent',
          icon: Icons.person_add_alt_1,
          variant: ReLoopButtonVariant.primary,
          onPressed: _invite,
        ),
        const SizedBox(height: 16),
        if (_agents.isEmpty)
          SizedBox(
            height: 160,
            child: Center(
              child: Text(
                'Belum ada travel agent.',
                style: TextStyle(color: context.reloopMutedSoft),
              ),
            ),
          )
        else
          ..._agents.map((item) {
            final agent = item as Map<String, dynamic>;
            final tripCount = (agent['tripCount'] as num?)?.toInt() ?? 0;
            final compliantCount =
                (agent['compliantCount'] as num?)?.toInt() ?? 0;
            final nonCompliantCount =
                (agent['nonCompliantCount'] as num?)?.toInt() ?? 0;
            final rate = tripCount > 0
                ? ((compliantCount / tripCount) * 100).round()
                : 0;
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
                                (agent['name'] as String?) ?? 'Travel Agent',
                                style: TextStyle(
                                  fontWeight: FontWeight.w600,
                                  fontSize: 14,
                                  color: context.reloopForeground,
                                ),
                              ),
                              if (agent['email'] != null)
                                Text(
                                  agent['email'] as String,
                                  style: TextStyle(
                                    fontSize: 11,
                                    color: context.reloopMutedSoft,
                                  ),
                                ),
                              if (agent['contactPerson'] != null)
                                Text(
                                  'CP: ${agent['contactPerson']}',
                                  style: TextStyle(
                                    fontSize: 11,
                                    color: context.reloopMutedSoft,
                                  ),
                                ),
                              if (agent['phone'] != null)
                                Text(
                                  'Telp: ${agent['phone']}',
                                  style: TextStyle(
                                    fontSize: 11,
                                    color: context.reloopMutedSoft,
                                  ),
                                ),
                            ],
                          ),
                        ),
                        StatusBadge(
                          statusKey:
                              (agent['organizationStatus'] as String?) ??
                              'PENDING',
                        ),
                      ],
                    ),
                    const SizedBox(height: 8),
                    Wrap(
                      spacing: 6,
                      runSpacing: 4,
                      children: [
                        _chip('$tripCount trip'),
                        _chip('$rate% patuh'),
                        _chip('$compliantCount compliant'),
                        if (nonCompliantCount > 0)
                          _chip('$nonCompliantCount tidak patuh'),
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
}
