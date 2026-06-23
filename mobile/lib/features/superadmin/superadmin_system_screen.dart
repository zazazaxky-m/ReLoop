import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/api_client.dart';
import '../../shared/widgets/metric_card.dart';
import '../../shared/widgets/reloop_card.dart';
import '../../theme/colors.dart';
import '../admin/admin_shell.dart';

enum SuperadminSystemMode { security, audit, config }

class SuperadminSystemScreen extends StatefulWidget {
  const SuperadminSystemScreen({
    super.key,
    required this.title,
    required this.mode,
  });

  final String title;
  final SuperadminSystemMode mode;

  @override
  State<SuperadminSystemScreen> createState() => _SuperadminSystemScreenState();
}

class _SuperadminSystemScreenState extends State<SuperadminSystemScreen> {
  Map<String, dynamic>? _data;
  String? _error;
  bool _saving = false;
  final Map<String, TextEditingController> _controllers = {};

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    for (final controller in _controllers.values) {
      controller.dispose();
    }
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final api = context.read<ApiClient>();
      final response = widget.mode == SuperadminSystemMode.config
          ? await api.get('/api/config')
          : await api.get('/api/mobile/audit-security');
      final data = response.data as Map<String, dynamic>;
      if (widget.mode == SuperadminSystemMode.config) {
        final config = data['config'] as Map<String, dynamic>? ?? {};
        for (final entry in config.entries) {
          if (entry.key == 'landing_hero_slides') continue;
          _controllers.putIfAbsent(
            entry.key,
            () => TextEditingController(text: entry.value.toString()),
          );
        }
      }
      if (mounted) setState(() => _data = data);
    } catch (error) {
      if (mounted) setState(() => _error = ApiClient.getErrorMessage(error));
    }
  }

  Future<void> _saveConfig() async {
    setState(() => _saving = true);
    try {
      await context.read<ApiClient>().patch(
        '/api/config',
        data: {
          for (final entry in _controllers.entries)
            entry.key: int.tryParse(entry.value.text) ?? entry.value.text,
        },
      );
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Konfigurasi berhasil disimpan.')),
        );
      }
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(ApiClient.getErrorMessage(error))),
        );
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return AdminShell(
      title: widget.title,
      child: RefreshIndicator(onRefresh: _load, child: _buildBody()),
    );
  }

  Widget _buildBody() {
    if (_data == null) {
      return ListView(
        padding: const EdgeInsets.all(24),
        children: [
          const SizedBox(height: 120),
          if (_error == null)
            const Center(child: CircularProgressIndicator())
          else ...[
            const Icon(
              Icons.cloud_off_rounded,
              size: 48,
              color: ReLoopColors.mutedSoft,
            ),
            const SizedBox(height: 12),
            Text(_error!, textAlign: TextAlign.center),
          ],
        ],
      );
    }
    if (widget.mode == SuperadminSystemMode.config) return _config();
    if (widget.mode == SuperadminSystemMode.security) return _security();
    return _audit();
  }

  Widget _security() {
    final summary =
        _data!['securitySummary'] as Map<String, dynamic>? ?? const {};
    final events = _data!['securityEvents'] as List? ?? const [];
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 10, 16, 100),
      children: [
        GridView.count(
          crossAxisCount: 2,
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          mainAxisSpacing: 12,
          crossAxisSpacing: 12,
          childAspectRatio: 1.4,
          children: [
            MetricCard(
              icon: Icons.notifications_active_outlined,
              label: 'Alert 24 jam',
              value: '${summary['alerts24h'] ?? 0}',
              tone: MetricTone.amber,
            ),
            MetricCard(
              icon: Icons.shield_outlined,
              label: 'Fraud 7 hari',
              value: '${summary['fraud7d'] ?? 0}',
              tone: MetricTone.amber,
            ),
            MetricCard(
              icon: Icons.warning_amber_rounded,
              label: 'Vandalisme',
              value: '${summary['vandalism7d'] ?? 0}',
              tone: MetricTone.blue,
            ),
            MetricCard(
              icon: Icons.recycling_outlined,
              label: 'Mesin terdampak',
              value: '${summary['affectedMachines7d'] ?? 0}',
              tone: MetricTone.teal,
            ),
          ],
        ),
        const SizedBox(height: 20),
        for (final raw in events)
          Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: _LogCard(data: raw as Map<String, dynamic>, security: true),
          ),
      ],
    );
  }

  Widget _audit() {
    final logs = _data!['auditLogs'] as List? ?? const [];
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 10, 16, 100),
      children: [
        for (final raw in logs)
          Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: _LogCard(data: raw as Map<String, dynamic>),
          ),
      ],
    );
  }

  Widget _config() {
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 10, 16, 100),
      children: [
        Text(
          'Kebijakan sistem',
          style: Theme.of(context).textTheme.headlineMedium,
        ),
        const SizedBox(height: 6),
        const Text(
          'Perubahan berlaku untuk seluruh organisasi dan aplikasi.',
          style: TextStyle(color: ReLoopColors.muted),
        ),
        const SizedBox(height: 20),
        ReLoopCard(
          child: Column(
            children: [
              for (final entry in _controllers.entries) ...[
                TextField(
                  controller: entry.value,
                  keyboardType: TextInputType.number,
                  decoration: InputDecoration(labelText: entry.key),
                ),
                const SizedBox(height: 14),
              ],
              SizedBox(
                width: double.infinity,
                child: FilledButton.icon(
                  onPressed: _saving ? null : _saveConfig,
                  icon: const Icon(Icons.check_rounded),
                  label: Text(_saving ? 'Menyimpan...' : 'Simpan perubahan'),
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _LogCard extends StatelessWidget {
  const _LogCard({required this.data, this.security = false});
  final Map<String, dynamic> data;
  final bool security;

  @override
  Widget build(BuildContext context) {
    final machine = data['machine'] as Map<String, dynamic>?;
    return ReLoopCard(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 40,
            height: 40,
            decoration: BoxDecoration(
              color: security ? const Color(0xFFFFF7E8) : ReLoopColors.brand50,
              borderRadius: BorderRadius.circular(12),
            ),
            child: Icon(
              security ? Icons.warning_amber_rounded : Icons.history_rounded,
              color: security ? ReLoopColors.warning : ReLoopColors.brand700,
              size: 20,
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  (data['eventType'] ?? data['action'] ?? 'Aktivitas')
                      .toString(),
                  style: const TextStyle(fontWeight: FontWeight.w700),
                ),
                const SizedBox(height: 4),
                Text(
                  [
                    machine?['name'],
                    data['entityType'],
                    data['occurredAt'] ?? data['createdAt'],
                  ].whereType<Object>().join(' · '),
                  style: const TextStyle(
                    color: ReLoopColors.muted,
                    fontSize: 11.5,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
