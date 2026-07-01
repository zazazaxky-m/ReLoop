import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/api_client.dart';
import '../../shared/widgets/empty_state.dart';
import '../../shared/widgets/metric_card.dart';
import '../../shared/widgets/reloop_card.dart';
import '../../shared/widgets/skeleton_loading.dart';
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
  final Map<String, Map<String, TextEditingController>> _slideControllers =
      {};
  List<Map<String, dynamic>> _mobileSlides = [];
  List<Map<String, dynamic>> _landingSlides = [];

  /// Metadata untuk field config yang dikenal. Field lain akan dirender
  /// generik menggunakan key sebagai label.
  static const Map<String, _ConfigFieldMeta> _knownFields = {
    'minRedemption': _ConfigFieldMeta(
      label: 'Minimum pencairan (Rp)',
      hint: '10000',
      helper: 'Poin reward yang dibutuhkan untuk dapat melakukan pencairan.',
      isNumber: true,
    ),
    'qrRotation': _ConfigFieldMeta(
      label: 'Rotasi QR (detik)',
      hint: '60',
      helper: 'Durasi rotasi kode QR deposit untuk mencegah screenshot.',
      isNumber: true,
    ),
    'pointsToRupiah': _ConfigFieldMeta(
      label: 'Poin ke Rupiah',
      hint: '1',
      helper: 'Faktor konversi: 1 poin = Rp x.',
      isNumber: true,
    ),
    'partnerInviteTtlHours': _ConfigFieldMeta(
      label: 'Masa aktif invite (jam)',
      hint: '72',
      helper: 'Berapa lama undangan partnership dapat digunakan.',
      isNumber: true,
    ),
    'redemptionDailyLimit': _ConfigFieldMeta(
      label: 'Limit pencairan harian',
      hint: '3',
      helper: 'Maksimal redemption per user per hari.',
      isNumber: true,
    ),
    'redemptionWeeklyLimit': _ConfigFieldMeta(
      label: 'Limit pencairan mingguan',
      hint: '10',
      helper: 'Maksimal redemption per user per minggu.',
      isNumber: true,
    ),
  };

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
    for (final map in _slideControllers.values) {
      for (final controller in map.values) {
        controller.dispose();
      }
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
        try {
          if (config['landing_hero_slides'] != null) {
            _landingSlides = List<Map<String, dynamic>>.from(
              jsonDecode(config['landing_hero_slides'].toString()),
            );
          }
        } catch (_) {}

        for (final entry in config.entries) {
          if (entry.key == 'landing_hero_slides' ||
              entry.key == 'mobile_hero_slides')
            continue;
          _controllers.putIfAbsent(
            entry.key,
            () => TextEditingController(text: entry.value.toString()),
          );
        }
        _ensureSlideControllers('mobile', _mobileSlides);
        _ensureSlideControllers('landing', _landingSlides);
      }
      if (mounted) setState(() => _data = data);
    } catch (error) {
      if (mounted) setState(() => _error = ApiClient.getErrorMessage(error));
    }
  }

  void _ensureSlideControllers(String key, List<Map<String, dynamic>> slides) {
    for (int i = 0; i < slides.length; i++) {
      final prefix = '$key-$i';
      final existing = _slideControllers[prefix];
      if (existing == null) {
        _slideControllers[prefix] = {
          'title': TextEditingController(
            text: slides[i]['title']?.toString() ?? '',
          ),
          'description': TextEditingController(
            text: slides[i]['description']?.toString() ?? '',
          ),
          'href': TextEditingController(
            text: slides[i]['href']?.toString() ?? '',
          ),
          'image': TextEditingController(
            text: slides[i]['image']?.toString() ?? '',
          ),
        };
      }
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
          'landing_hero_slides': jsonEncode(_landingSlides),
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
    if (_data == null && _error == null) {
      return ListView(
        padding: const EdgeInsets.fromLTRB(16, 10, 16, 100),
        children: const [
          SkeletonListTile(),
          SizedBox(height: 10),
          SkeletonListTile(),
          SizedBox(height: 10),
          SkeletonListTile(),
          SizedBox(height: 10),
          SkeletonListTile(),
        ],
      );
    }
    if (_error != null) {
      return _ErrorState(message: _error!, onRetry: _load);
    }
    if (widget.mode == SuperadminSystemMode.config) return _config();
    if (widget.mode == SuperadminSystemMode.security) return _security();
    return _audit();
  }

  Widget _security() {
    final summary =
        _data!['securitySummary'] as Map<String, dynamic>? ?? const {};
    final events = _data!['securityEvents'] as List? ?? const [];
    final alerts24h = (summary['alerts24h'] as num?)?.toInt() ?? 0;
    final fraud7d = (summary['fraud7d'] as num?)?.toInt() ?? 0;
    final vandalism7d = (summary['vandalism7d'] as num?)?.toInt() ?? 0;
    final affectedMachines = (summary['affectedMachines7d'] as num?)?.toInt() ?? 0;
    final hasIncident = alerts24h > 0 || fraud7d > 0 || vandalism7d > 0;
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 100),
      children: [
        _SecurityHeroBanner(
          hasIncident: hasIncident,
          alerts24h: alerts24h,
          fraud7d: fraud7d,
          vandalism7d: vandalism7d,
          affectedMachines: affectedMachines,
        ),
        const SizedBox(height: 18),
        const _SectionLabel(
          icon: Icons.insights_rounded,
          text: 'Ringkasan ancaman',
        ),
        const SizedBox(height: 10),
        GridView.count(
          crossAxisCount: 2,
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          mainAxisSpacing: 12,
          crossAxisSpacing: 12,
          childAspectRatio: 1.35,
          children: [
            MetricCard(
              icon: Icons.notifications_active_outlined,
              label: 'Alert 24 jam',
              value: '$alerts24h',
              hint: alerts24h == 0
                  ? 'Tidak ada alert baru'
                  : 'Perlu ditinjau',
              tone: alerts24h > 0 ? MetricTone.red : MetricTone.amber,
            ),
            MetricCard(
              icon: Icons.shield_outlined,
              label: 'Fraud 7 hari',
              value: '$fraud7d',
              hint: 'Insiden fraud terdeteksi',
              tone: fraud7d > 0 ? MetricTone.red : MetricTone.amber,
            ),
            MetricCard(
              icon: Icons.warning_amber_rounded,
              label: 'Vandalisme',
              value: '$vandalism7d',
              hint: 'Aksi vandalisme 7 hari',
              tone: vandalism7d > 0 ? MetricTone.red : MetricTone.blue,
            ),
            MetricCard(
              icon: Icons.recycling_outlined,
              label: 'Mesin terdampak',
              value: '$affectedMachines',
              hint: 'Unit yang perlu dicek',
              tone: affectedMachines > 0 ? MetricTone.amber : MetricTone.teal,
            ),
          ],
        ),
        const SizedBox(height: 22),
        const _SectionLabel(
          icon: Icons.history_toggle_off_rounded,
          text: 'Timeline alert terbaru',
        ),
        const SizedBox(height: 10),
        if (events.isEmpty)
          const _SecurityEmptyTimeline()
        else
          for (var i = 0; i < events.length; i++)
            Padding(
              padding: EdgeInsets.only(bottom: i == events.length - 1 ? 0 : 12),
              child: _SecurityEventTile(
                data: events[i] as Map<String, dynamic>,
                isFirst: i == 0,
                isLast: i == events.length - 1,
              ),
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
                    color: isSelected
                        ? context.reloopBrandText
                        : context.reloopForeground,
                    fontWeight: isSelected
                        ? FontWeight.bold
                        : FontWeight.normal,
                  ),
                ),
              );
            }).toList(),
          ),
        ),
        Expanded(
          child: filteredLogs.isEmpty
              ? EmptyState(
                  icon: Icons.history_rounded,
                  title: 'Belum ada log aktivitas',
                  description: _auditFilter.isNotEmpty
                      ? 'Tidak ada log untuk kategori $_auditFilter.'
                      : 'Aktivitas sistem akan tercatat di sini.',
                )
              : ListView.builder(
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
    // Urutkan field: yang dikenal dulu, sisanya urut abjad.
    final entries = _controllers.entries.toList();
    entries.sort((a, b) {
      final aKnown = _knownFields.containsKey(a.key) ? 0 : 1;
      final bKnown = _knownFields.containsKey(b.key) ? 0 : 1;
      if (aKnown != bKnown) return aKnown - bKnown;
      return a.key.compareTo(b.key);
    });

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
              for (final entry in entries) ...[
                _ConfigField(
                  keyName: entry.key,
                  controller: entry.value,
                  meta: _knownFields[entry.key],
                  onChanged: (v) => _controllers[entry.key]!.text = v,
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
            child: _SlideEditor(
              title: 'Slide ${i + 1}',
              controllers: _slideControllers['mobile-$i']!,
              onDelete: () => _removeSlide('mobile', i),
            ),
          ),
        OutlinedButton.icon(
          onPressed: _addMobileSlide,
          icon: const Icon(Icons.add),
          label: const Text('Tambah Slide'),
        ),
        const SizedBox(height: 32),
        Text(
          'Konten Carousel Landing Page',
          style: Theme.of(context).textTheme.headlineMedium,
        ),
        const SizedBox(height: 12),
        for (int i = 0; i < _landingSlides.length; i++)
          Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: _SlideEditor(
              title: 'Slide ${i + 1}',
              controllers: _slideControllers['landing-$i']!,
              onDelete: () => _removeSlide('landing', i),
            ),
          ),
        OutlinedButton.icon(
          onPressed: _addLandingSlide,
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

  void _addMobileSlide() {
    _addSlide('mobile', _mobileSlides, '/campaigns');
  }

  void _addLandingSlide() {
    _addSlide('landing', _landingSlides, '/register');
  }

  void _addSlide(
    String key,
    List<Map<String, dynamic>> target,
    String defaultHref,
  ) {
    setState(() {
      target.add({
        'title': 'Judul baru',
        'description': 'Deskripsi singkat.',
        'href': defaultHref,
        'image': '',
      });
      final i = target.length - 1;
      _slideControllers['$key-$i'] = {
        'title': TextEditingController(text: target[i]['title']),
        'description': TextEditingController(text: target[i]['description']),
        'href': TextEditingController(text: target[i]['href']),
        'image': TextEditingController(text: target[i]['image']),
      };
    });
  }

  void _removeSlide(String key, int index) {
    setState(() {
      // Buang controller untuk index yang dihapus & geser sisanya.
      _slideControllers['$key-$index']?.forEach((_, c) => c.dispose());
      _slideControllers.remove('$key-$index');
      if (key == 'mobile') {
        _mobileSlides.removeAt(index);
        _reindexSlideControllers('mobile', _mobileSlides.length);
      } else {
        _landingSlides.removeAt(index);
        _reindexSlideControllers('landing', _landingSlides.length);
      }
    });
  }

  void _reindexSlideControllers(String key, int newLength) {
    final remaining = <String, Map<String, TextEditingController>>{};
    for (int i = 0; i < newLength; i++) {
      final old = _slideControllers['$key-${i + 1}'];
      if (old != null) {
        remaining['$key-$i'] = old;
      }
    }
    _slideControllers.removeWhere((k, v) => k.startsWith('$key-'));
    _slideControllers.addAll(remaining);
  }
}

class _ErrorState extends StatelessWidget {
  const _ErrorState({required this.message, required this.onRetry});
  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.all(24),
      children: [
        const SizedBox(height: 120),
        Icon(
          Icons.cloud_off_rounded,
          size: 48,
          color: context.reloopMutedSoft,
        ),
        const SizedBox(height: 12),
        Text(
          message,
          textAlign: TextAlign.center,
          style: TextStyle(color: context.reloopMuted),
        ),
        const SizedBox(height: 8),
        Center(
          child: TextButton(onPressed: onRetry, child: Text('Coba lagi')),
        ),
      ],
    );
  }
}

class _LogCard extends StatelessWidget {
  const _LogCard({required this.data});
  final Map<String, dynamic> data;

  @override
  Widget build(BuildContext context) {
    final machine = data['machine'] as Map<String, dynamic>?;
    final action = (data['eventType'] ?? data['action'] ?? 'Aktivitas')
        .toString();
    final entityType = data['entityType']?.toString();
    final entityId = data['entityId']?.toString();
    final actor = data['actor'] as Map<String, dynamic>?;
    final actorName = actor?['name']?.toString();
    final actorRole = actor?['role']?.toString();
    final timestamp =
        data['occurredAt']?.toString() ?? data['createdAt']?.toString();

    return ReLoopCard(
      padding: const EdgeInsets.all(14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: 36,
                height: 36,
                decoration: BoxDecoration(
                  color: context.reloopBrandSoft,
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Icon(
                  _iconForEntity(entityType),
                  color: context.reloopBrandText,
                  size: 18,
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            action,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              fontWeight: FontWeight.w800,
                              fontSize: 13.5,
                            ),
                          ),
                        ),
                        if (timestamp != null)
                          Text(
                            _formatTimestamp(timestamp),
                            style: TextStyle(
                              fontSize: 10.5,
                              color: context.reloopMutedSoft,
                            ),
                          ),
                      ],
                    ),
                    const SizedBox(height: 3),
                    Row(
                      children: [
                        if (entityType != null) ...[
                          Container(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 6,
                              vertical: 2,
                            ),
                            decoration: BoxDecoration(
                              color: context.reloopBrandSoft,
                              borderRadius: BorderRadius.circular(5),
                            ),
                            child: Text(
                              entityType,
                              style: TextStyle(
                                fontSize: 10,
                                fontWeight: FontWeight.w700,
                                color: context.reloopBrandText,
                              ),
                            ),
                          ),
                          const SizedBox(width: 6),
                        ],
                        Expanded(
                          child: Text(
                            actorName != null
                                ? '$actorName (${actorRole ?? '-'})'
                                : 'Sistem',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                              fontSize: 11.5,
                              color: context.reloopMuted,
                              fontWeight: FontWeight.w500,
                            ),
                          ),
                        ),
                      ],
                    ),
                    if (entityId != null || machine != null) ...[
                      const SizedBox(height: 4),
                      Text(
                        [
                          if (entityId != null)
                            'ID: ${_truncate(entityId, 12)}',
                          machine?['name']?.toString(),
                        ].whereType<String>().join(' · '),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          fontSize: 11,
                          color: context.reloopMutedSoft,
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  IconData _iconForEntity(String? entityType) {
    switch (entityType) {
      case 'Machine':
        return Icons.recycling_rounded;
      case 'DepositSession':
        return Icons.receipt_long_outlined;
      case 'OrganizationCollectorPartner':
        return Icons.handshake_outlined;
      case 'PickupRequest':
        return Icons.local_shipping_outlined;
      case 'Redemption':
        return Icons.account_balance_wallet_outlined;
      case 'Campaign':
        return Icons.campaign_outlined;
      case 'WasteType':
        return Icons.delete_outline;
      case 'Trip':
        return Icons.luggage_outlined;
      default:
        return Icons.history_rounded;
    }
  }

  String _truncate(String s, int max) {
    if (s.length <= max) return s;
    return '${s.substring(0, max)}…';
  }

  String _formatTimestamp(String iso) {
    try {
      final dt = DateTime.parse(iso);
      final now = DateTime.now();
      final diff = now.difference(dt);
      if (diff.inMinutes < 1) return 'baru saja';
      if (diff.inMinutes < 60) return '${diff.inMinutes}m';
      if (diff.inHours < 24) return '${diff.inHours}j';
      if (diff.inDays < 7) return '${diff.inDays}h';
      return '${dt.day}/${dt.month}/${dt.year}';
    } catch (_) {
      return iso;
    }
  }
}

class _ConfigFieldMeta {
  const _ConfigFieldMeta({
    required this.label,
    this.hint,
    this.helper,
    this.isNumber = false,
  });

  final String label;
  final String? hint;
  final String? helper;
  final bool isNumber;
}

class _ConfigField extends StatelessWidget {
  const _ConfigField({
    required this.keyName,
    required this.controller,
    required this.onChanged,
    this.meta,
  });

  final String keyName;
  final TextEditingController controller;
  final _ConfigFieldMeta? meta;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    final m = meta;
    return TextField(
      controller: controller,
      onChanged: onChanged,
      keyboardType: m?.isNumber == true
          ? const TextInputType.numberWithOptions(decimal: false)
          : TextInputType.text,
      decoration: InputDecoration(
        labelText: m?.label ?? keyName,
        hintText: m?.hint,
        helperText: m?.helper,
        helperStyle: TextStyle(
          color: context.reloopMuted,
          fontSize: 11,
        ),
      ),
    );
  }
}

class _SlideEditor extends StatelessWidget {
  const _SlideEditor({
    required this.title,
    required this.controllers,
    required this.onDelete,
  });

  final String title;
  final Map<String, TextEditingController> controllers;
  final VoidCallback onDelete;

  @override
  Widget build(BuildContext context) {
    final imageText = controllers['image']?.text ?? '';
    final hasImage = imageText.isNotEmpty;
    return ReLoopCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                title,
                style: const TextStyle(fontWeight: FontWeight.bold),
              ),
              IconButton(
                icon: const Icon(
                  Icons.delete_outline,
                  color: ReLoopColors.warning,
                ),
                onPressed: onDelete,
              ),
            ],
          ),
          if (hasImage) ...[
            ClipRRect(
              borderRadius: BorderRadius.circular(10),
              child: Image.network(
                imageText,
                height: 120,
                width: double.infinity,
                fit: BoxFit.cover,
                errorBuilder: (_, _, _) => Container(
                  height: 120,
                  width: double.infinity,
                  decoration: BoxDecoration(
                    color: context.reloopBrandSoft,
                    borderRadius: BorderRadius.circular(10),
                  ),
                  alignment: Alignment.center,
                  child: Text(
                    'Gagal memuat gambar',
                    style: TextStyle(color: context.reloopMuted, fontSize: 11),
                  ),
                ),
              ),
            ),
            const SizedBox(height: 8),
          ],
          TextField(
            decoration: const InputDecoration(labelText: 'Judul'),
            controller: controllers['title'],
          ),
          const SizedBox(height: 8),
          TextField(
            decoration: const InputDecoration(labelText: 'Deskripsi'),
            controller: controllers['description'],
            maxLines: 2,
          ),
          const SizedBox(height: 8),
          TextField(
            decoration: const InputDecoration(
              labelText: 'Link (opsional)',
              hintText: '/campaigns',
            ),
            controller: controllers['href'],
          ),
          const SizedBox(height: 8),
          TextField(
            decoration: const InputDecoration(
              labelText: 'URL Gambar (opsional)',
              hintText: 'https://...',
            ),
            controller: controllers['image'],
            keyboardType: TextInputType.url,
          ),
        ],
      ),
    );
  }
}

class _SectionLabel extends StatelessWidget {
  const _SectionLabel({required this.icon, required this.text});

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Container(
          width: 30,
          height: 30,
          decoration: BoxDecoration(
            color: context.reloopBrandSoft,
            borderRadius: BorderRadius.circular(10),
          ),
          child: Icon(icon, size: 16, color: context.reloopBrandText),
        ),
        const SizedBox(width: 10),
        Text(
          text,
          style: TextStyle(
            fontSize: 13.5,
            fontWeight: FontWeight.w800,
            color: context.reloopForeground,
            letterSpacing: -0.2,
          ),
        ),
      ],
    );
  }
}

class _SecurityHeroBanner extends StatelessWidget {
  const _SecurityHeroBanner({
    required this.hasIncident,
    required this.alerts24h,
    required this.fraud7d,
    required this.vandalism7d,
    required this.affectedMachines,
  });

  final bool hasIncident;
  final int alerts24h;
  final int fraud7d;
  final int vandalism7d;
  final int affectedMachines;

  @override
  Widget build(BuildContext context) {
    final dark = context.isDarkMode;
    final accent = hasIncident
        ? (dark ? const Color(0xFFFCA5A5) : const Color(0xFFB91C1C))
        : (dark ? ReLoopColors.brand300 : ReLoopColors.brand600);
    final surfaceStart = hasIncident
        ? (dark ? const Color(0xFF2A1313) : const Color(0xFFFFF5F5))
        : (dark ? const Color(0xFF142B1E) : const Color(0xFFF1FBF4));
    final surfaceEnd = hasIncident
        ? (dark ? const Color(0xFF3A1A1A) : const Color(0xFFFEE2E2))
        : (dark ? const Color(0xFF1B3527) : const Color(0xFFE6F6EC));
    final iconBg = hasIncident
        ? (dark ? const Color(0xFF3A1A1A) : const Color(0xFFFEE2E2))
        : (dark ? const Color(0xFF1F4530) : ReLoopColors.brand50);
    return Container(
      padding: const EdgeInsets.fromLTRB(18, 18, 18, 18),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(22),
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [surfaceStart, surfaceEnd],
        ),
        border: Border.all(color: accent.withValues(alpha: 0.22)),
        boxShadow: dark
            ? const [
                BoxShadow(
                  color: Color(0x52000000),
                  blurRadius: 18,
                  offset: Offset(0, 8),
                ),
              ]
            : const [
                BoxShadow(
                  color: Color(0x080F172A),
                  blurRadius: 2,
                  offset: Offset(0, 1),
                ),
                BoxShadow(
                  color: Color(0x0A0F172A),
                  blurRadius: 24,
                  offset: Offset(0, 10),
                ),
              ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: 52,
                height: 52,
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(18),
                  gradient: LinearGradient(
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                    colors: [iconBg, accent.withValues(alpha: 0.22)],
                  ),
                  border: Border.all(
                    color: accent.withValues(alpha: 0.32),
                    width: 1,
                  ),
                ),
                child: Icon(
                  hasIncident
                      ? Icons.report_problem_rounded
                      : Icons.verified_user_rounded,
                  color: accent,
                  size: 26,
                ),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 8,
                            vertical: 3,
                          ),
                          decoration: BoxDecoration(
                            color: accent.withValues(alpha: 0.18),
                            borderRadius: BorderRadius.circular(20),
                          ),
                          child: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Container(
                                width: 6,
                                height: 6,
                                decoration: BoxDecoration(
                                  color: accent,
                                  shape: BoxShape.circle,
                                ),
                              ),
                              const SizedBox(width: 6),
                              Text(
                                hasIncident
                                    ? 'PERLU TINJAUAN'
                                    : 'STATUS AMAN',
                                style: TextStyle(
                                  fontSize: 10,
                                  fontWeight: FontWeight.w800,
                                  color: accent,
                                  letterSpacing: 0.6,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 6),
                    Text(
                      hasIncident
                          ? 'Ada ancaman yang belum ditangani'
                          : 'Sistem berjalan normal',
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w800,
                        color: context.reloopForeground,
                        height: 1.25,
                        letterSpacing: -0.3,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      hasIncident
                          ? 'Tinjau alert di bawah, lalu ambil tindakan mitigasi.'
                          : 'Belum ada fraud, vandalisme, atau alert 24 jam terakhir.',
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        fontSize: 12.5,
                        color: context.reloopMuted,
                        height: 1.35,
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          Row(
            children: [
              _BannerStat(
                label: 'Alert',
                value: '$alerts24h',
                tone: alerts24h > 0 ? MetricTone.red : MetricTone.green,
              ),
              const SizedBox(width: 8),
              _BannerStat(
                label: 'Fraud',
                value: '$fraud7d',
                tone: fraud7d > 0 ? MetricTone.red : MetricTone.green,
              ),
              const SizedBox(width: 8),
              _BannerStat(
                label: 'Vandal',
                value: '$vandalism7d',
                tone: vandalism7d > 0 ? MetricTone.red : MetricTone.green,
              ),
              const SizedBox(width: 8),
              _BannerStat(
                label: 'Mesin',
                value: '$affectedMachines',
                tone: affectedMachines > 0 ? MetricTone.amber : MetricTone.green,
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _BannerStat extends StatelessWidget {
  const _BannerStat({
    required this.label,
    required this.value,
    required this.tone,
  });

  final String label;
  final String value;
  final MetricTone tone;

  @override
  Widget build(BuildContext context) {
    final isAlert = tone == MetricTone.red;
    final color = isAlert
        ? (context.isDarkMode ? const Color(0xFFFCA5A5) : const Color(0xFFB91C1C))
        : (context.isDarkMode ? ReLoopColors.brand300 : ReLoopColors.brand600);
    return Expanded(
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 8),
        decoration: BoxDecoration(
          color: context.isDarkMode
              ? Colors.white.withValues(alpha: 0.04)
              : Colors.white.withValues(alpha: 0.7),
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: color.withValues(alpha: 0.18)),
        ),
        child: Column(
          children: [
            Text(
              value,
              style: TextStyle(
                fontSize: 18,
                fontWeight: FontWeight.w800,
                color: color,
                height: 1.1,
                letterSpacing: -0.3,
              ),
            ),
            const SizedBox(height: 2),
            Text(
              label,
              style: TextStyle(
                fontSize: 10.5,
                fontWeight: FontWeight.w700,
                color: context.reloopMuted,
                letterSpacing: 0.4,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _SecurityEmptyTimeline extends StatelessWidget {
  const _SecurityEmptyTimeline();

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(20, 22, 20, 22),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(20),
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: context.isDarkMode
              ? [const Color(0xFF142B1E), const Color(0xFF1B3527)]
              : [const Color(0xFFF1FBF4), const Color(0xFFE6F6EC)],
        ),
        border: Border.all(
          color: ReLoopColors.brand500.withValues(alpha: 0.18),
        ),
      ),
      child: Column(
        children: [
          Container(
            width: 52,
            height: 52,
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(18),
              color: ReLoopColors.brand50,
            ),
            child: Icon(
              Icons.shield_outlined,
              color: ReLoopColors.brand600,
              size: 28,
            ),
          ),
          const SizedBox(height: 12),
          Text(
            'Tidak ada alert keamanan',
            style: TextStyle(
              fontSize: 14.5,
              fontWeight: FontWeight.w800,
              color: context.reloopForeground,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            'Belum ada aktivitas fraud atau vandalisme yang terdeteksi.',
            textAlign: TextAlign.center,
            style: TextStyle(
              fontSize: 12.5,
              color: context.reloopMuted,
              height: 1.4,
            ),
          ),
        ],
      ),
    );
  }
}

class _SecurityEventTile extends StatelessWidget {
  const _SecurityEventTile({
    required this.data,
    required this.isFirst,
    required this.isLast,
  });

  final Map<String, dynamic> data;
  final bool isFirst;
  final bool isLast;

  @override
  Widget build(BuildContext context) {
    final action = (data['eventType'] ?? data['action'] ?? 'Aktivitas')
        .toString();
    final entityType = data['entityType']?.toString();
    final machine = data['machine'] as Map<String, dynamic>?;
    final severity = (data['severity']?.toString() ?? 'medium').toLowerCase();
    final timestamp =
        data['occurredAt']?.toString() ?? data['createdAt']?.toString();
    final note = data['note']?.toString() ?? data['description']?.toString();

    final palette = _severityPalette(context, severity);
    final icon = _iconForAction(action, severity);
    return Row(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        // Timeline rail
        SizedBox(
          width: 28,
          child: Column(
            children: [
              Container(
                width: 2,
                height: 6,
                color: isFirst
                    ? Colors.transparent
                    : context.reloopBorder,
              ),
              Container(
                width: 14,
                height: 14,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: palette.dot,
                  border: Border.all(
                    color: context.reloopSurfaceRaised,
                    width: 2.5,
                  ),
                  boxShadow: [
                    BoxShadow(
                      color: palette.dot.withValues(alpha: 0.35),
                      blurRadius: 6,
                      spreadRadius: 1,
                    ),
                  ],
                ),
              ),
              Expanded(
                child: Container(
                  width: 2,
                  color: isLast
                      ? Colors.transparent
                      : context.reloopBorder,
                ),
              ),
            ],
          ),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: Container(
            padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(18),
              color: context.reloopSurfaceRaised,
              border: Border.all(color: context.reloopBorder),
              boxShadow: context.isDarkMode
                  ? const [
                      BoxShadow(
                        color: Color(0x40000000),
                        blurRadius: 12,
                        offset: Offset(0, 6),
                      ),
                    ]
                  : const [
                      BoxShadow(
                        color: Color(0x080F172A),
                        blurRadius: 2,
                        offset: Offset(0, 1),
                      ),
                      BoxShadow(
                        color: Color(0x080F172A),
                        blurRadius: 14,
                        offset: Offset(0, 6),
                      ),
                    ],
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Container(
                      width: 36,
                      height: 36,
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(12),
                        gradient: LinearGradient(
                          begin: Alignment.topLeft,
                          end: Alignment.bottomRight,
                          colors: [palette.iconBg, palette.iconBgHi],
                        ),
                      ),
                      child: Icon(icon, size: 18, color: palette.iconFg),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            action,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                              fontSize: 14,
                              fontWeight: FontWeight.w800,
                              color: context.reloopForeground,
                              height: 1.2,
                              letterSpacing: -0.2,
                            ),
                          ),
                          if (timestamp != null) ...[
                            const SizedBox(height: 2),
                            Text(
                              _formatTimestamp(timestamp),
                              style: TextStyle(
                                fontSize: 11.5,
                                color: context.reloopMutedSoft,
                                fontWeight: FontWeight.w500,
                              ),
                            ),
                          ],
                        ],
                      ),
                    ),
                    _SeverityChip(label: palette.label, color: palette.chip),
                  ],
                ),
                if (note != null && note.isNotEmpty) ...[
                  const SizedBox(height: 10),
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.symmetric(
                      horizontal: 10,
                      vertical: 8,
                    ),
                    decoration: BoxDecoration(
                      color: palette.surface,
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: Text(
                      note,
                      style: TextStyle(
                        fontSize: 12,
                        color: context.reloopForeground,
                        height: 1.4,
                      ),
                    ),
                  ),
                ],
                if (entityType != null || machine != null) ...[
                  const SizedBox(height: 10),
                  Wrap(
                    spacing: 6,
                    runSpacing: 6,
                    children: [
                      if (entityType != null)
                        _MetaPill(
                          icon: Icons.category_outlined,
                          label: entityType,
                        ),
                      if (machine != null && machine['name'] != null)
                        _MetaPill(
                          icon: Icons.recycling_outlined,
                          label: machine['name'].toString(),
                        ),
                    ],
                  ),
                ],
              ],
            ),
          ),
        ),
      ],
    );
  }

  _SecurityPalette _severityPalette(BuildContext context, String severity) {
    final dark = context.isDarkMode;
    switch (severity) {
      case 'high':
      case 'critical':
        return _SecurityPalette(
          label: 'TINGGI',
          dot: dark ? const Color(0xFFFCA5A5) : const Color(0xFFB91C1C),
          chip: dark
              ? const Color(0xFF3A1A1A)
              : const Color(0xFFFEE2E2),
          iconBg: dark
              ? const Color(0xFF3A1A1A)
              : const Color(0xFFFEE2E2),
          iconBgHi: dark
              ? const Color(0xFF4A2222)
              : const Color(0xFFFECACA),
          iconFg: dark ? const Color(0xFFFCA5A5) : const Color(0xFFB91C1C),
          surface: dark
              ? const Color(0xFF2A1313)
              : const Color(0xFFFFF5F5),
        );
      case 'low':
        return _SecurityPalette(
          label: 'RENDAH',
          dot: dark ? const Color(0xFF7AE2D8) : const Color(0xFF0F766E),
          chip: dark
              ? const Color(0xFF19413D)
              : const Color(0xFFCCFBF1),
          iconBg: dark
              ? const Color(0xFF19413D)
              : const Color(0xFFCCFBF1),
          iconBgHi: dark
              ? const Color(0xFF1F504B)
              : const Color(0xFF99F6E4),
          iconFg: dark ? const Color(0xFF7AE2D8) : const Color(0xFF0F766E),
          surface: dark
              ? const Color(0xFF102B28)
              : const Color(0xFFF0FDFA),
        );
      case 'medium':
      default:
        return _SecurityPalette(
          label: 'SEDANG',
          dot: dark ? const Color(0xFFF5B85C) : const Color(0xFFB45309),
          chip: dark
              ? const Color(0xFF3E2B18)
              : const Color(0xFFFEF3C7),
          iconBg: dark
              ? const Color(0xFF3E2B18)
              : const Color(0xFFFEF3C7),
          iconBgHi: dark
              ? const Color(0xFF52391F)
              : const Color(0xFFFDE68A),
          iconFg: dark ? const Color(0xFFF5B85C) : const Color(0xFFB45309),
          surface: dark
              ? const Color(0xFF2A1F10)
              : const Color(0xFFFFFBEB),
        );
    }
  }

  IconData _iconForAction(String action, String severity) {
    final a = action.toLowerCase();
    if (a.contains('fraud') || severity == 'high' || severity == 'critical') {
      return Icons.gpp_maybe_rounded;
    }
    if (a.contains('vandal')) return Icons.broken_image_outlined;
    if (a.contains('login') || a.contains('auth')) {
      return Icons.lock_open_rounded;
    }
    if (a.contains('machine') || a.contains('rvm')) {
      return Icons.recycling_rounded;
    }
    return Icons.warning_amber_rounded;
  }

  String _formatTimestamp(String iso) {
    try {
      final dt = DateTime.parse(iso);
      final now = DateTime.now();
      final diff = now.difference(dt);
      if (diff.inMinutes < 1) return 'baru saja';
      if (diff.inMinutes < 60) return '${diff.inMinutes}m lalu';
      if (diff.inHours < 24) return '${diff.inHours}j lalu';
      if (diff.inDays < 7) return '${diff.inDays}h lalu';
      return '${dt.day}/${dt.month}/${dt.year}';
    } catch (_) {
      return iso;
    }
  }
}

class _SecurityPalette {
  const _SecurityPalette({
    required this.label,
    required this.dot,
    required this.chip,
    required this.iconBg,
    required this.iconBgHi,
    required this.iconFg,
    required this.surface,
  });
  final String label;
  final Color dot;
  final Color chip;
  final Color iconBg;
  final Color iconBgHi;
  final Color iconFg;
  final Color surface;
}

class _SeverityChip extends StatelessWidget {
  const _SeverityChip({required this.label, required this.color});

  final String label;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: color,
        borderRadius: BorderRadius.circular(20),
      ),
      child: Text(
        label,
        style: TextStyle(
          fontSize: 9.5,
          fontWeight: FontWeight.w800,
          color: color.computeLuminance() > 0.5
              ? const Color(0xFF7C2D12)
              : const Color(0xFFFECACA),
          letterSpacing: 0.6,
        ),
      ),
    );
  }
}

class _MetaPill extends StatelessWidget {
  const _MetaPill({required this.icon, required this.label});

  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: context.reloopSurface,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: context.reloopBorder),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 12, color: context.reloopMuted),
          const SizedBox(width: 4),
          Text(
            label,
            style: TextStyle(
              fontSize: 10.5,
              fontWeight: FontWeight.w700,
              color: context.reloopMuted,
              letterSpacing: 0.2,
            ),
          ),
        ],
      ),
    );
  }
}
