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
        if (events.isEmpty)
          const EmptyState(
            icon: Icons.shield_outlined,
            title: 'Tidak ada alert keamanan',
            description:
                'Belum ada aktivitas fraud atau vandalisme yang terdeteksi.',
          )
        else
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
  const _LogCard({required this.data, this.security = false});
  final Map<String, dynamic> data;
  final bool security;

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
                  color: security
                      ? (context.isDarkMode
                            ? const Color(0xFF3A2D17)
                            : const Color(0xFFFFF7E8))
                      : context.reloopBrandSoft,
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Icon(
                  security
                      ? Icons.warning_amber_rounded
                      : _iconForEntity(entityType),
                  color: security
                      ? ReLoopColors.warning
                      : context.reloopBrandText,
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
