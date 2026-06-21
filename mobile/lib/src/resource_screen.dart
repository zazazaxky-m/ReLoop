import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:url_launcher/url_launcher.dart';

import 'api_client.dart';

enum ResourceActionType { none, pickup, partnership, redemption }

class ResourceScreen extends StatefulWidget {
  const ResourceScreen({
    super.key,
    required this.api,
    required this.title,
    required this.endpoint,
    required this.rootKey,
    required this.primaryFields,
    required this.secondaryFields,
    this.actionType = ResourceActionType.none,
  });

  final ApiClient api;
  final String title;
  final String endpoint;
  final String rootKey;
  final List<String> primaryFields;
  final List<String> secondaryFields;
  final ResourceActionType actionType;

  @override
  State<ResourceScreen> createState() => _ResourceScreenState();
}

class _ResourceScreenState extends State<ResourceScreen> {
  List<dynamic>? _rows;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _error = null);
    try {
      final uri = Uri.parse(widget.endpoint);
      final data = await widget.api.get(
        uri.path,
        query: uri.queryParameters.isEmpty ? null : uri.queryParameters,
      );
      final value = data[widget.rootKey];
      if (mounted) setState(() => _rows = value is List ? value : []);
    } on ApiException catch (error) {
      if (mounted) setState(() => _error = error.message);
    } catch (_) {
      if (mounted) {
        setState(() => _error = 'Data ${widget.title} gagal dimuat.');
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_rows == null && _error == null) {
      return const Center(child: CircularProgressIndicator());
    }
    if (_error != null) {
      return _ResourceError(message: _error!, retry: _load);
    }
    return RefreshIndicator(
      onRefresh: _load,
      child: _rows!.isEmpty
          ? ListView(
              children: const [
                SizedBox(height: 140),
                Icon(Icons.inbox_outlined, size: 64, color: Colors.grey),
                SizedBox(height: 12),
                Center(child: Text('Belum ada data.')),
              ],
            )
          : ListView.separated(
              padding: const EdgeInsets.all(18),
              itemCount: _rows!.length,
              separatorBuilder: (_, _) => const SizedBox(height: 10),
              itemBuilder: (context, index) {
                final row = _rows![index] as Map<String, dynamic>;
                return _ResourceCard(
                  row: row,
                  primaryFields: widget.primaryFields,
                  secondaryFields: widget.secondaryFields,
                  actionType: widget.actionType,
                  api: widget.api,
                  onChanged: _load,
                );
              },
            ),
    );
  }
}

class _ResourceCard extends StatelessWidget {
  const _ResourceCard({
    required this.row,
    required this.primaryFields,
    required this.secondaryFields,
    required this.actionType,
    required this.api,
    required this.onChanged,
  });

  final Map<String, dynamic> row;
  final List<String> primaryFields;
  final List<String> secondaryFields;
  final ResourceActionType actionType;
  final ApiClient api;
  final Future<void> Function() onChanged;

  @override
  Widget build(BuildContext context) {
    final organization = _nestedName(row['organization']);
    final machine = _nestedName(row['machine']);
    final user = _nestedName(row['user']);
    final primary = primaryFields
        .map((key) => _display(row[key]))
        .where((value) => value.isNotEmpty)
        .toList();
    final secondary = [
      organization,
      machine,
      user,
      ...secondaryFields.map((key) => _display(row[key])),
    ].where((value) => value.isNotEmpty).toList();

    return Card(
      child: InkWell(
        borderRadius: BorderRadius.circular(18),
        onTap: () => _details(context),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  const CircleAvatar(child: Icon(Icons.recycling_outlined)),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Text(
                      primary.isEmpty ? 'ReLoop' : primary.join(' • '),
                      style: const TextStyle(fontWeight: FontWeight.w800),
                    ),
                  ),
                  if (row['status'] != null)
                    Chip(
                      label: Text(
                        row['status'].toString().replaceAll('_', ' '),
                      ),
                      visualDensity: VisualDensity.compact,
                    ),
                ],
              ),
              if (secondary.isNotEmpty) ...[
                const SizedBox(height: 10),
                Text(
                  secondary.join(' • '),
                  maxLines: 3,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(color: Colors.grey.shade700, height: 1.4),
                ),
              ],
              if (actionType != ResourceActionType.none) ...[
                const SizedBox(height: 12),
                Wrap(spacing: 8, runSpacing: 8, children: _actions(context)),
              ],
            ],
          ),
        ),
      ),
    );
  }

  List<Widget> _actions(BuildContext context) {
    final status = row['status']?.toString();
    final actions = <(String, String)>[];
    if (actionType == ResourceActionType.pickup) {
      if (status == 'ASSIGNED') actions.add(('Berangkat', 'start'));
      if (status == 'ON_THE_WAY') actions.add(('Tiba', 'arrive'));
      if (status == 'ARRIVED') actions.add(('Ambil', 'collect'));
      if (status == 'COLLECTED') actions.add(('Selesaikan', 'complete'));
      if (!['COMPLETED', 'FAILED', 'CANCELLED'].contains(status)) {
        actions.add(('Gagal', 'fail'));
      }
    } else if (actionType == ResourceActionType.partnership) {
      if (status == 'INVITED') {
        actions.addAll([('Terima', 'accept'), ('Tolak', 'decline')]);
      } else if (status == 'PENDING_SUPERADMIN_APPROVAL') {
        actions.addAll([('Setujui', 'approve'), ('Tolak', 'reject')]);
      } else if (status == 'ACTIVE') {
        actions.add(('Suspend', 'suspend'));
      } else if (status == 'SUSPENDED') {
        actions.add(('Aktifkan', 'reactivate'));
      }
    } else if (actionType == ResourceActionType.redemption) {
      if (status == 'REQUESTED') actions.add(('Setujui', 'approve'));
      if (status == 'APPROVED') actions.add(('Proses', 'process'));
      if (status == 'PROCESSING') {
        actions.addAll([('Berhasil', 'success'), ('Gagal', 'fail')]);
      }
    }
    return [
      for (final action in actions)
        OutlinedButton(
          onPressed: () => _runAction(context, action.$2),
          child: Text(action.$1),
        ),
    ];
  }

  Future<void> _runAction(BuildContext context, String action) async {
    try {
      final base = switch (actionType) {
        ResourceActionType.pickup => '/api/pickups',
        ResourceActionType.partnership => '/api/partnerships',
        ResourceActionType.redemption => '/api/redemptions',
        ResourceActionType.none => '',
      };
      await api.patch('$base/${row['id']}', {'action': action});
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Perubahan berhasil disimpan.')),
        );
      }
      await onChanged();
    } on ApiException catch (error) {
      if (context.mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(error.message)));
      }
    }
  }

  void _details(BuildContext context) => showModalBottomSheet<void>(
    context: context,
    showDragHandle: true,
    isScrollControlled: true,
    builder: (context) => DraggableScrollableSheet(
      expand: false,
      initialChildSize: .7,
      maxChildSize: .95,
      builder: (context, controller) => ListView(
        controller: controller,
        padding: const EdgeInsets.fromLTRB(20, 0, 20, 24),
        children: [
          const Text(
            'Detail',
            style: TextStyle(fontSize: 22, fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 12),
          for (final entry in row.entries)
            if (entry.value != null)
              ListTile(
                contentPadding: EdgeInsets.zero,
                title: Text(_label(entry.key)),
                subtitle: SelectableText(_display(entry.value)),
              ),
        ],
      ),
    ),
  );
}

class AuditSecurityScreen extends StatefulWidget {
  const AuditSecurityScreen({super.key, required this.api});
  final ApiClient api;

  @override
  State<AuditSecurityScreen> createState() => _AuditSecurityScreenState();
}

class _AuditSecurityScreenState extends State<AuditSecurityScreen> {
  Map<String, dynamic>? data;
  String? error;

  @override
  void initState() {
    super.initState();
    load();
  }

  Future<void> load() async {
    try {
      final result = await widget.api.get('/api/mobile/audit-security');
      if (mounted) setState(() => data = result);
    } on ApiException catch (e) {
      if (mounted) setState(() => error = e.message);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (data == null) {
      return error == null
          ? const Center(child: CircularProgressIndicator())
          : _ResourceError(message: error!, retry: load);
    }
    final summary = data!['securitySummary'] as Map<String, dynamic>;
    final events = data!['securityEvents'] as List;
    final logs = data!['auditLogs'] as List;
    return RefreshIndicator(
      onRefresh: load,
      child: ListView(
        padding: const EdgeInsets.all(18),
        children: [
          Wrap(
            spacing: 10,
            runSpacing: 10,
            children: [
              _Summary('Alert 24 jam', summary['alerts24h']),
              _Summary('Fraud 7 hari', summary['fraud7d']),
              _Summary('Vandalisme', summary['vandalism7d']),
              _Summary('Mesin terdampak', summary['affectedMachines7d']),
            ],
          ),
          const SizedBox(height: 20),
          const Text(
            'Log keamanan',
            style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 8),
          for (final event in events)
            ListTile(
              leading: const Icon(
                Icons.warning_amber_rounded,
                color: Colors.orange,
              ),
              title: Text((event as Map)['eventType'].toString()),
              subtitle: Text(
                '${_nestedName(event['machine'])} • ${event['occurredAt']}',
              ),
            ),
          const Divider(height: 28),
          const Text(
            'Audit sistem',
            style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 8),
          for (final log in logs)
            ListTile(
              leading: const Icon(Icons.history),
              title: Text((log as Map)['action'].toString()),
              subtitle: Text('${log['entityType']} • ${log['createdAt']}'),
            ),
        ],
      ),
    );
  }
}

class ConfigScreen extends StatefulWidget {
  const ConfigScreen({super.key, required this.api});
  final ApiClient api;

  @override
  State<ConfigScreen> createState() => _ConfigScreenState();
}

class _ConfigScreenState extends State<ConfigScreen> {
  final controllers = <String, TextEditingController>{};
  bool busy = true;
  String? error;

  @override
  void initState() {
    super.initState();
    load();
  }

  Future<void> load() async {
    try {
      final data = await widget.api.get('/api/config');
      final config = data['config'] as Map<String, dynamic>;
      for (final entry in config.entries) {
        controllers.putIfAbsent(
          entry.key,
          () => TextEditingController(text: entry.value.toString()),
        );
      }
    } on ApiException catch (e) {
      error = e.message;
    }
    if (mounted) setState(() => busy = false);
  }

  Future<void> save() async {
    setState(() => busy = true);
    try {
      await widget.api.patch('/api/config', {
        for (final entry in controllers.entries)
          if (entry.key != 'landing_hero_slides')
            entry.key: int.tryParse(entry.value.text) ?? 0,
      });
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(const SnackBar(content: Text('Konfigurasi tersimpan.')));
      }
    } on ApiException catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(e.message)));
      }
    }
    if (mounted) setState(() => busy = false);
  }

  @override
  Widget build(BuildContext context) {
    if (busy && controllers.isEmpty) {
      return const Center(child: CircularProgressIndicator());
    }
    if (error != null) return _ResourceError(message: error!, retry: load);
    return ListView(
      padding: const EdgeInsets.all(20),
      children: [
        for (final entry in controllers.entries)
          if (entry.key != 'landing_hero_slides') ...[
            TextField(
              controller: entry.value,
              keyboardType: TextInputType.number,
              decoration: InputDecoration(labelText: _label(entry.key)),
            ),
            const SizedBox(height: 14),
          ],
        FilledButton.icon(
          onPressed: busy ? null : save,
          icon: const Icon(Icons.save_outlined),
          label: const Text('Simpan konfigurasi'),
        ),
      ],
    );
  }
}

class ReportsScreen extends StatelessWidget {
  const ReportsScreen({super.key, required this.api});
  final ApiClient api;

  @override
  Widget build(BuildContext context) => ListView(
    padding: const EdgeInsets.all(20),
    children: [
      const Text(
        'Ekspor laporan CSV',
        style: TextStyle(fontSize: 22, fontWeight: FontWeight.w800),
      ),
      const SizedBox(height: 8),
      const Text(
        'File dibuka melalui browser agar dapat disimpan atau dibagikan.',
      ),
      const SizedBox(height: 20),
      for (final item in const [
        ('deposits', 'Deposit'),
        ('rewards', 'Reward'),
        ('pickups', 'Pickup'),
      ])
        Card(
          child: ListTile(
            leading: const Icon(Icons.table_view_outlined),
            title: Text('${item.$2} CSV'),
            trailing: const Icon(Icons.open_in_new),
            onTap: () => launchUrl(
              Uri.parse('${api.baseUrl}/api/reports?type=${item.$1}'),
              mode: LaunchMode.externalApplication,
            ),
          ),
        ),
    ],
  );
}

class _Summary extends StatelessWidget {
  const _Summary(this.label, this.value);
  final String label;
  final dynamic value;

  @override
  Widget build(BuildContext context) => SizedBox(
    width: 160,
    child: Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              '$value',
              style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w800),
            ),
            Text(label),
          ],
        ),
      ),
    ),
  );
}

class _ResourceError extends StatelessWidget {
  const _ResourceError({required this.message, required this.retry});
  final String message;
  final VoidCallback retry;

  @override
  Widget build(BuildContext context) => Center(
    child: Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        const Icon(Icons.error_outline, size: 48),
        const SizedBox(height: 12),
        Text(message),
        const SizedBox(height: 12),
        FilledButton(onPressed: retry, child: const Text('Coba lagi')),
      ],
    ),
  );
}

String _nestedName(dynamic value) =>
    value is Map && value['name'] != null ? value['name'].toString() : '';

String _display(dynamic value) {
  if (value == null) return '';
  if (value is bool) return value ? 'Aktif' : 'Tidak aktif';
  if (value is num && value.abs() >= 1000) {
    return NumberFormat.decimalPattern('id_ID').format(value);
  }
  if (value is Map || value is List) {
    return const JsonEncoder.withIndent('  ').convert(value);
  }
  return value.toString();
}

String _label(String value) => value
    .replaceAllMapped(RegExp(r'([A-Z])'), (match) => ' ${match.group(1)}')
    .replaceAll('_', ' ')
    .trim()
    .split(' ')
    .map(
      (word) =>
          word.isEmpty ? word : '${word[0].toUpperCase()}${word.substring(1)}',
    )
    .join(' ');
