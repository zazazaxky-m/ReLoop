import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/api_client.dart';
import '../../shared/widgets/reloop_card.dart';
import '../../shared/widgets/skeleton_loading.dart';
import '../../shared/widgets/status_badge.dart';
import '../../theme/colors.dart';
import '../admin/admin_shell.dart';

enum SuperadminResourceAction {
  none,
  partnership,
  redemption,
  user,
  organization,
}

class SuperadminResourceScreen extends StatefulWidget {
  const SuperadminResourceScreen({
    super.key,
    required this.title,
    required this.endpoint,
    required this.rootKey,
    required this.primaryFields,
    this.secondaryFields = const [],
    this.action = SuperadminResourceAction.none,
  });

  final String title;
  final String endpoint;
  final String rootKey;
  final List<String> primaryFields;
  final List<String> secondaryFields;
  final SuperadminResourceAction action;

  @override
  State<SuperadminResourceScreen> createState() =>
      _SuperadminResourceScreenState();
}

class _SuperadminResourceScreenState extends State<SuperadminResourceScreen> {
  List<dynamic>? _rows;
  String? _error;
  String _query = '';

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _error = null);
    try {
      final uri = Uri.parse(widget.endpoint);
      final response = await context.read<ApiClient>().get(
        uri.path,
        queryParameters: uri.queryParameters.isEmpty
            ? null
            : uri.queryParameters,
      );
      final data = response.data as Map<String, dynamic>;
      if (mounted) {
        setState(() => _rows = (data[widget.rootKey] as List?) ?? []);
      }
    } catch (error) {
      if (mounted) setState(() => _error = ApiClient.getErrorMessage(error));
    }
  }

  @override
  Widget build(BuildContext context) {
    final rows = (_rows ?? []).where((row) {
      if (_query.isEmpty) return true;
      return jsonEncode(row).toLowerCase().contains(_query.toLowerCase());
    }).toList();

    return AdminShell(
      title: widget.title,
      child: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 10, 16, 100),
          children: [
            TextField(
              onChanged: (value) => setState(() => _query = value),
              decoration: const InputDecoration(
                hintText: 'Cari data',
                prefixIcon: Icon(Icons.search_rounded),
              ),
            ),
            const SizedBox(height: 16),
            if (_rows == null && _error == null)
              const SkeletonListTile()
            else if (_error != null)
              _ErrorState(message: _error!, retry: _load)
            else if (rows.isEmpty)
              const Padding(
                padding: EdgeInsets.only(top: 80),
                child: Center(child: Text('Belum ada data.')),
              )
            else
              for (final raw in rows)
                Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: _ResourceCard(
                    row: raw as Map<String, dynamic>,
                    primaryFields: widget.primaryFields,
                    secondaryFields: widget.secondaryFields,
                    action: widget.action,
                    onChanged: _load,
                  ),
                ),
          ],
        ),
      ),
    );
  }
}

class _ResourceCard extends StatelessWidget {
  const _ResourceCard({
    required this.row,
    required this.primaryFields,
    required this.secondaryFields,
    required this.action,
    required this.onChanged,
  });

  final Map<String, dynamic> row;
  final List<String> primaryFields;
  final List<String> secondaryFields;
  final SuperadminResourceAction action;
  final Future<void> Function() onChanged;

  String _value(String key) {
    final value = row[key];
    if (value == null) return '';
    if (value is Map) return value['name']?.toString() ?? '';
    return value.toString();
  }

  @override
  Widget build(BuildContext context) {
    final title = primaryFields
        .map(_value)
        .where((e) => e.isNotEmpty)
        .join(' · ');
    final subtitle = secondaryFields
        .map(_value)
        .where((e) => e.isNotEmpty)
        .join(' · ');

    return ReLoopCard(
      padding: EdgeInsets.zero,
      child: InkWell(
        borderRadius: BorderRadius.circular(20),
        onTap: () => _showDetails(context),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Container(
                    width: 42,
                    height: 42,
                    decoration: BoxDecoration(
                      color: ReLoopColors.brand50,
                      borderRadius: BorderRadius.circular(13),
                    ),
                    child: const Icon(
                      Icons.layers_outlined,
                      color: ReLoopColors.brand700,
                      size: 20,
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          title.isEmpty ? 'ReLoop' : title,
                          style: const TextStyle(
                            fontWeight: FontWeight.w700,
                            fontSize: 14,
                          ),
                        ),
                        if (subtitle.isNotEmpty) ...[
                          const SizedBox(height: 3),
                          Text(
                            subtitle,
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              color: ReLoopColors.muted,
                              fontSize: 11.5,
                            ),
                          ),
                        ],
                      ],
                    ),
                  ),
                  if (row['status'] != null)
                    StatusBadge(statusKey: row['status'].toString()),
                ],
              ),
              if (_actions().isNotEmpty) ...[
                const SizedBox(height: 14),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    for (final item in _actions())
                      OutlinedButton(
                        onPressed: () => _runAction(context, item.$2),
                        child: Text(item.$1),
                      ),
                  ],
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  List<(String, String)> _actions() {
    final status = row['status']?.toString();
    if (action == SuperadminResourceAction.partnership) {
      if (status == 'PENDING_SUPERADMIN_APPROVAL') {
        return [('Setujui', 'approve'), ('Tolak', 'reject')];
      }
      if (status == 'ACTIVE') return [('Suspend', 'suspend')];
      if (status == 'SUSPENDED') return [('Aktifkan', 'reactivate')];
    }
    if (action == SuperadminResourceAction.redemption) {
      if (status == 'REQUESTED') return [('Setujui', 'approve')];
      if (status == 'APPROVED') return [('Proses', 'process')];
      if (status == 'PROCESSING') {
        return [('Berhasil', 'success'), ('Gagal', 'fail')];
      }
    }
    if (action == SuperadminResourceAction.user) {
      return [
        (
          status == 'ACTIVE' ? 'Nonaktifkan' : 'Aktifkan',
          status == 'ACTIVE' ? 'INACTIVE' : 'ACTIVE',
        ),
      ];
    }
    if (action == SuperadminResourceAction.organization) {
      return [
        (
          status == 'ACTIVE' ? 'Suspend' : 'Aktifkan',
          status == 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE',
        ),
      ];
    }
    return [];
  }

  Future<void> _runAction(BuildContext context, String value) async {
    final api = context.read<ApiClient>();
    try {
      if (action == SuperadminResourceAction.partnership) {
        await api.patch(
          '/api/partnerships/${row['id']}',
          data: {'action': value},
        );
      } else if (action == SuperadminResourceAction.redemption) {
        await api.patch(
          '/api/redemptions/${row['id']}',
          data: {'action': value},
        );
      } else if (action == SuperadminResourceAction.user) {
        await api.patch('/api/users/${row['id']}', data: {'status': value});
      } else if (action == SuperadminResourceAction.organization) {
        await api.patch(
          '/api/organizations/${row['id']}',
          data: {'status': value},
        );
      }
      await onChanged();
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Perubahan berhasil disimpan.')),
        );
      }
    } catch (error) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(ApiClient.getErrorMessage(error))),
        );
      }
    }
  }

  void _showDetails(BuildContext context) {
    showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      isScrollControlled: true,
      builder: (context) => DraggableScrollableSheet(
        expand: false,
        initialChildSize: .72,
        maxChildSize: .94,
        builder: (context, controller) => ListView(
          controller: controller,
          padding: const EdgeInsets.fromLTRB(20, 0, 20, 32),
          children: [
            Text('Detail', style: Theme.of(context).textTheme.headlineMedium),
            const SizedBox(height: 12),
            for (final entry in row.entries)
              if (entry.value != null)
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  title: Text(entry.key),
                  subtitle: SelectableText(
                    entry.value is Map || entry.value is List
                        ? const JsonEncoder.withIndent(
                            '  ',
                          ).convert(entry.value)
                        : entry.value.toString(),
                  ),
                ),
          ],
        ),
      ),
    );
  }
}

class _ErrorState extends StatelessWidget {
  const _ErrorState({required this.message, required this.retry});
  final String message;
  final VoidCallback retry;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: 80),
      child: Column(
        children: [
          const Icon(
            Icons.cloud_off_rounded,
            size: 48,
            color: ReLoopColors.mutedSoft,
          ),
          const SizedBox(height: 12),
          Text(message, textAlign: TextAlign.center),
          TextButton(onPressed: retry, child: const Text('Coba lagi')),
        ],
      ),
    );
  }
}
