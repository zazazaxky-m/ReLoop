import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/api_client.dart';
import '../../shared/widgets/empty_state.dart';
import '../../shared/widgets/filter_chips.dart';
import '../../shared/widgets/reloop_card.dart';
import '../../shared/widgets/search_bar.dart';
import '../../shared/widgets/skeleton_loading.dart';
import '../../theme/colors.dart';
import '../admin/admin_shell.dart';

class SuperadminRegionsScreen extends StatefulWidget {
  const SuperadminRegionsScreen({super.key});

  @override
  State<SuperadminRegionsScreen> createState() =>
      _SuperadminRegionsScreenState();
}

class _SuperadminRegionsScreenState extends State<SuperadminRegionsScreen> {
  List<dynamic>? _rows;
  String? _error;
  String _query = '';
  String? _typeFilter;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _error = null);
    try {
      final res = await context.read<ApiClient>().get('/api/regions');
      if (mounted) {
        setState(() {
          _rows = (res.data['regions'] as List?) ?? [];
        });
      }
    } catch (error) {
      if (mounted) setState(() => _error = ApiClient.getErrorMessage(error));
    }
  }

  Future<void> _save(
    Map<String, dynamic> data, [
    String? id,
  ]) async {
    try {
      final api = context.read<ApiClient>();
      if (id == null) {
        await api.post('/api/regions', data: data);
      } else {
        await api.patch('/api/regions/$id', data: data);
      }
      await _load();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(id == null ? 'Wilayah dibuat' : 'Perubahan disimpan'),
            backgroundColor: ReLoopColors.success,
          ),
        );
      }
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(ApiClient.getErrorMessage(error)),
            backgroundColor: ReLoopColors.danger,
          ),
        );
      }
    }
  }

  Future<void> _delete(String id) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Hapus wilayah?'),
        content: const Text(
          'Tindakan ini tidak dapat dibatalkan. Wilayah hanya dapat dihapus jika tidak ada organisasi, mesin, atau sub-wilayah yang terhubung.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Batal'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: ReLoopColors.danger),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Hapus'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    if (!mounted) return;
    final api = context.read<ApiClient>();
    final messenger = ScaffoldMessenger.of(context);
    try {
      await api.delete('/api/regions/$id');
      await _load();
      if (!mounted) return;
      messenger.showSnackBar(
        const SnackBar(
          content: Text('Wilayah dihapus'),
          backgroundColor: ReLoopColors.success,
        ),
      );
    } catch (error) {
      if (!mounted) return;
      messenger.showSnackBar(
        SnackBar(
          content: Text(ApiClient.getErrorMessage(error)),
          backgroundColor: ReLoopColors.danger,
        ),
      );
    }
  }

  void _showCreate() {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (ctx) => _RegionForm(
        regions: _rows ?? [],
        onSubmit: (data) => _save(data),
      ),
    );
  }

  void _showEdit(Map<String, dynamic> region) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (ctx) => _RegionForm(
        regions: (_rows ?? []).where((r) => r['id'] != region['id']).toList(),
        initial: region,
        onSubmit: (data) => _save(data, region['id']),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final rows = (_rows ?? []).where((row) {
      final r = row as Map<String, dynamic>;
      if (_typeFilter != null && r['type'] != _typeFilter) return false;
      if (_query.isEmpty) return true;
      return jsonEncode(r).toLowerCase().contains(_query.toLowerCase());
    }).toList();

    return AdminShell(
      title: 'Wilayah',
      actions: [IconButton(icon: const Icon(Icons.add), onPressed: _showCreate)],
      child: RefreshIndicator(
        onRefresh: _load,
        child: _body(rows),
      ),
    );
  }

  Widget _body(List<dynamic> rows) {
    if (_rows == null && _error == null) {
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
    return CustomScrollView(
      slivers: [
        SliverPadding(
          padding: const EdgeInsets.fromLTRB(16, 10, 16, 8),
          sliver: SliverToBoxAdapter(
            child: ReLoopSearchBar(
              hintText: 'Cari wilayah...',
              onChanged: (v) => setState(() => _query = v),
            ),
          ),
        ),
        SliverPadding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
          sliver: SliverToBoxAdapter(
            child: ReLoopFilterChips(
              label: 'Tipe',
              options: const ['PROVINCE', 'REGENCY', 'DISTRICT', 'VILLAGE'],
              selected: _typeFilter,
              onSelected: (v) => setState(() => _typeFilter = v),
            ),
          ),
        ),
        if (rows.isEmpty)
          SliverFillRemaining(
            hasScrollBody: false,
            child: EmptyState(
              icon: Icons.public_outlined,
              title: 'Belum ada wilayah',
              description: _query.isNotEmpty || _typeFilter != null
                  ? 'Coba ubah pencarian atau filter.'
                  : 'Tambahkan wilayah baru dengan tombol + di kanan atas.',
            ),
          )
        else
          SliverPadding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 100),
            sliver: SliverList.builder(
              itemCount: rows.length,
              itemBuilder: (context, index) {
                final raw = rows[index] as Map<String, dynamic>;
                return Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: _RegionCard(
                    row: raw,
                    onEdit: () => _showEdit(raw),
                    onDelete: () => _delete(raw['id']),
                  ),
                );
              },
            ),
          ),
      ],
    );
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

class _RegionCard extends StatelessWidget {
  const _RegionCard({
    required this.row,
    required this.onEdit,
    required this.onDelete,
  });
  final Map<String, dynamic> row;
  final VoidCallback onEdit;
  final VoidCallback onDelete;

  @override
  Widget build(BuildContext context) {
    return ReLoopCard(
      padding: const EdgeInsets.all(16),
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
                      row['name'] ?? '',
                      style: const TextStyle(fontWeight: FontWeight.bold),
                    ),
                    if (row['parent']?['name'] != null) ...[
                      const SizedBox(height: 2),
                      Text(
                        '↳ ${row['parent']?['name']}',
                        style: TextStyle(
                          color: context.reloopMuted,
                          fontSize: 12,
                        ),
                      ),
                    ],
                  ],
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                decoration: BoxDecoration(
                  color: ReLoopColors.info.withValues(alpha: .1),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Text(
                  row['type'] ?? '',
                  style: const TextStyle(
                    color: ReLoopColors.info,
                    fontSize: 10,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Text(
            'Sub-wilayah: ${row['childCount'] ?? 0} | Organisasi: ${row['orgCount'] ?? 0}',
            style: const TextStyle(fontSize: 12),
          ),
          const SizedBox(height: 10),
          Row(
            mainAxisAlignment: MainAxisAlignment.end,
            children: [
              OutlinedButton.icon(
                style: OutlinedButton.styleFrom(
                  foregroundColor: context.reloopBrandText,
                  side: BorderSide(
                    color: context.reloopBrandText.withValues(alpha: .4),
                  ),
                  minimumSize: const Size(0, 32),
                  padding: const EdgeInsets.symmetric(horizontal: 12),
                ),
                onPressed: onEdit,
                icon: const Icon(Icons.edit_outlined, size: 14),
                label: const Text(
                  'Edit',
                  style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700),
                ),
              ),
              const SizedBox(width: 8),
              OutlinedButton.icon(
                style: OutlinedButton.styleFrom(
                  foregroundColor: ReLoopColors.danger,
                  side: BorderSide(
                    color: ReLoopColors.danger.withValues(alpha: .5),
                  ),
                  minimumSize: const Size(0, 32),
                  padding: const EdgeInsets.symmetric(horizontal: 12),
                ),
                onPressed: onDelete,
                icon: const Icon(Icons.delete_outline, size: 14),
                label: const Text(
                  'Hapus',
                  style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _RegionForm extends StatefulWidget {
  const _RegionForm({
    required this.regions,
    required this.onSubmit,
    this.initial,
  });
  final List<dynamic> regions;
  final Map<String, dynamic>? initial;
  final ValueChanged<Map<String, dynamic>> onSubmit;

  @override
  State<_RegionForm> createState() => _RegionFormState();
}

class _RegionFormState extends State<_RegionForm> {
  final _name = TextEditingController();
  String _type = 'VILLAGE';
  String? _parentId;
  bool _saving = false;

  final _types = ["PROVINCE", "REGENCY", "DISTRICT", "VILLAGE"];

  @override
  void initState() {
    super.initState();
    final i = widget.initial ?? const {};
    _name.text = i['name']?.toString() ?? '';
    _type = (i['type'] as String?) ?? 'VILLAGE';
    _parentId = (i['parentId'] as String?) ?? (i['parent']?['id'] as String?);
  }

  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (_name.text.trim().isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Nama wajib diisi.')),
      );
      return;
    }
    setState(() => _saving = true);
    widget.onSubmit({
      'name': _name.text.trim(),
      'type': _type,
      'parentId': _parentId,
    });
    if (mounted) Navigator.pop(context);
  }

  @override
  Widget build(BuildContext context) {
    final isEdit = widget.initial != null;
    return Padding(
      padding: EdgeInsets.only(
        bottom: MediaQuery.of(context).viewInsets.bottom,
        left: 16,
        right: 16,
        top: 24,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            isEdit ? 'Edit Wilayah' : 'Tambah Wilayah',
            style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 16),
          DropdownButtonFormField<String>(
            value: _type,
            items: _types
                .map((t) => DropdownMenuItem(value: t, child: Text(t)))
                .toList(),
            onChanged: (v) => setState(() => _type = v!),
            decoration: const InputDecoration(
              labelText: 'Tipe',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _name,
            decoration: const InputDecoration(
              labelText: 'Nama',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 12),
          DropdownButtonFormField<String?>(
            value: _parentId,
            items: [
              const DropdownMenuItem(value: null, child: Text('- Tidak ada -')),
              ...widget.regions.map(
                (r) => DropdownMenuItem(
                  value: r['id'] as String,
                  child: Text('${r['name']} (${r['type']})'),
                ),
              ),
            ],
            onChanged: (v) => setState(() => _parentId = v),
            decoration: const InputDecoration(
              labelText: 'Induk (Kosong untuk provinsi)',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 24),
          ElevatedButton(
            onPressed: _saving ? null : _save,
            child: Text(_saving ? 'Menyimpan...' : 'Simpan'),
          ),
          const SizedBox(height: 24),
        ],
      ),
    );
  }
}
