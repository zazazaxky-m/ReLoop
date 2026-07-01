import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/api_client.dart';
import '../../shared/widgets/reloop_card.dart';
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

  void _showForm() {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (ctx) => _RegionForm(regions: _rows ?? [], onSaved: _load),
    );
  }

  @override
  Widget build(BuildContext context) {
    final rows = (_rows ?? []).where((row) {
      if (_query.isEmpty) return true;
      return jsonEncode(row).toLowerCase().contains(_query.toLowerCase());
    }).toList();

    return AdminShell(
      title: 'Wilayah',
      actions: [IconButton(icon: const Icon(Icons.add), onPressed: _showForm)],
      child: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 10, 16, 100),
          children: [
            TextField(
              onChanged: (value) => setState(() => _query = value),
              decoration: const InputDecoration(
                hintText: 'Cari wilayah...',
                prefixIcon: Icon(Icons.search_rounded),
              ),
            ),
            const SizedBox(height: 16),
            if (_rows == null && _error == null)
              const SkeletonListTile()
            else if (_error != null)
              Center(child: Text(_error!))
            else if (rows.isEmpty)
              Center(
                child: Padding(
                  padding: EdgeInsets.only(top: 80),
                  child: Text('Belum ada wilayah.'),
                ),
              )
            else
              for (final raw in rows)
                Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: _RegionCard(row: raw as Map<String, dynamic>),
                ),
          ],
        ),
      ),
    );
  }
}

class _RegionCard extends StatelessWidget {
  const _RegionCard({required this.row});
  final Map<String, dynamic> row;

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
        ],
      ),
    );
  }
}

class _RegionForm extends StatefulWidget {
  const _RegionForm({required this.regions, required this.onSaved});
  final List<dynamic> regions;
  final VoidCallback onSaved;

  @override
  State<_RegionForm> createState() => _RegionFormState();
}

class _RegionFormState extends State<_RegionForm> {
  final _name = TextEditingController();
  String _type = 'VILLAGE';
  String? _parentId;
  bool _saving = false;

  final _types = ["PROVINCE", "REGENCY", "DISTRICT", "VILLAGE"];

  Future<void> _save() async {
    if (_name.text.isEmpty) return;
    setState(() => _saving = true);
    try {
      await context.read<ApiClient>().post(
        '/api/regions',
        data: {
          'name': _name.text,
          'type': _type,
          if (_parentId != null) 'parentId': _parentId,
        },
      );
      widget.onSaved();
      if (mounted) Navigator.pop(context);
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(ApiClient.getErrorMessage(e))));
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
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
            'Tambah Wilayah',
            style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
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
              DropdownMenuItem(value: null, child: Text('- Tidak ada -')),
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
