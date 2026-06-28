import 'dart:convert';
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
  String _auditFilter = '';
  final Map<String, TextEditingController> _controllers = {};
  List<Map<String, dynamic>> _mobileSlides = [];

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
        
        try {
          if (config['mobile_hero_slides'] != null) {
            _mobileSlides = List<Map<String, dynamic>>.from(
              jsonDecode(config['mobile_hero_slides'].toString()),
            );
          }
        } catch (_) {}

        for (final entry in config.entries) {
          if (entry.key == 'landing_hero_slides' || entry.key == 'mobile_hero_slides') continue;
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
          'mobile_hero_slides': jsonEncode(_mobileSlides),
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
    
    final filters = [
      '',
      'Machine',
      'DepositSession',
      'OrganizationCollectorPartner',
      'PickupRequest',
      'Redemption',
      'Campaign',
      'WasteType',
      'Trip',
    ];

    final filteredLogs = logs.where((raw) {
      if (_auditFilter.isEmpty) return true;
      final data = raw as Map<String, dynamic>;
      return data['entityType'] == _auditFilter;
    }).toList();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        SizedBox(
          height: 48,
          child: ListView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 16),
            children: filters.map((f) {
              final isSelected = _auditFilter == f;
              return Padding(
                padding: const EdgeInsets.only(right: 8),
                child: FilterChip(
                  label: Text(f.isEmpty ? 'Semua' : f),
                  selected: isSelected,
                  onSelected: (_) => setState(() => _auditFilter = f),
                  selectedColor: context.reloopBrandSoft,
                  checkmarkColor: context.reloopBrandText,
                  labelStyle: TextStyle(
                    color: isSelected ? context.reloopBrandText : context.reloopForeground,
                    fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
                  ),
                ),
              );
            }).toList(),
          ),
        ),
        Expanded(
          child: ListView.builder(
            padding: const EdgeInsets.fromLTRB(16, 10, 16, 100),
            itemCount: filteredLogs.length,
            itemBuilder: (context, index) {
              final raw = filteredLogs[index] as Map<String, dynamic>;
              return Padding(
                padding: const EdgeInsets.only(bottom: 10),
                child: _LogCard(data: raw),
              );
            },
          ),
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
        Text(
          'Perubahan berlaku untuk seluruh organisasi dan aplikasi.',
          style: TextStyle(color: context.reloopMuted),
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
            ],
          ),
        ),
        const SizedBox(height: 24),
        Text(
          'Konten Carousel Mobile',
          style: Theme.of(context).textTheme.headlineMedium,
        ),
        const SizedBox(height: 12),
        for (int i = 0; i < _mobileSlides.length; i++)
          Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: ReLoopCard(
              child: Column(
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text('Slide ${i + 1}', style: const TextStyle(fontWeight: FontWeight.bold)),
                      IconButton(
                        icon: const Icon(Icons.delete_outline, color: ReLoopColors.warning),
                        onPressed: () => setState(() => _mobileSlides.removeAt(i)),
                      ),
                    ],
                  ),
                  TextField(
                    decoration: const InputDecoration(labelText: 'Title'),
                    controller: TextEditingController(text: _mobileSlides[i]['title'])..selection = TextSelection.collapsed(offset: _mobileSlides[i]['title']?.length ?? 0),
                    onChanged: (v) => _mobileSlides[i]['title'] = v,
                  ),
                  const SizedBox(height: 8),
                  TextField(
                    decoration: const InputDecoration(labelText: 'Description'),
                    controller: TextEditingController(text: _mobileSlides[i]['description'])..selection = TextSelection.collapsed(offset: _mobileSlides[i]['description']?.length ?? 0),
                    onChanged: (v) => _mobileSlides[i]['description'] = v,
                  ),
                  const SizedBox(height: 8),
                  TextField(
                    decoration: const InputDecoration(labelText: 'Link (opsional)'),
                    controller: TextEditingController(text: _mobileSlides[i]['href'])..selection = TextSelection.collapsed(offset: _mobileSlides[i]['href']?.length ?? 0),
                    onChanged: (v) => _mobileSlides[i]['href'] = v,
                  ),
                ],
              ),
            ),
          ),
        OutlinedButton.icon(
          onPressed: () {
            setState(() {
              _mobileSlides.add({
                'title': 'Judul baru',
                'description': 'Deskripsi singkat.',
                'href': '/campaigns',
              });
            });
          },
          icon: const Icon(Icons.add),
          label: const Text('Tambah Slide'),
        ),
        const SizedBox(height: 32),
        SizedBox(
          width: double.infinity,
          child: FilledButton.icon(
            onPressed: _saving ? null : _saveConfig,
            icon: const Icon(Icons.check_rounded),
            label: Text(_saving ? 'Menyimpan...' : 'Simpan perubahan'),
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
              color: security ? (context.isDarkMode ? const Color(0xFF3A2D17) : const Color(0xFFFFF7E8)) : context.reloopBrandSoft,
              borderRadius: BorderRadius.circular(12),
            ),
            child: Icon(
              security ? Icons.warning_amber_rounded : Icons.history_rounded,
              color: security ? ReLoopColors.warning : context.reloopBrandText,
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
                  style: TextStyle(
                    color: context.reloopMuted,
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
