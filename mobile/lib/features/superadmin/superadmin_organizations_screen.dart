import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/api_client.dart';
import '../../shared/widgets/reloop_card.dart';
import '../../shared/widgets/skeleton_loading.dart';
import '../../shared/widgets/status_badge.dart';
import '../../theme/colors.dart';
import '../admin/admin_shell.dart';

class SuperadminOrganizationsScreen extends StatefulWidget {
  const SuperadminOrganizationsScreen({super.key});

  @override
  State<SuperadminOrganizationsScreen> createState() => _SuperadminOrganizationsScreenState();
}

class _SuperadminOrganizationsScreenState extends State<SuperadminOrganizationsScreen> {
  List<dynamic>? _rows;
  List<dynamic>? _regions;
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
      final api = context.read<ApiClient>();
      final resOrg = await api.get('/api/organizations');
      final resReg = await api.get('/api/regions');
      
      if (mounted) {
        setState(() {
          _rows = (resOrg.data['organizations'] as List?) ?? [];
          _regions = (resReg.data['regions'] as List?) ?? [];
        });
      }
    } catch (error) {
      if (mounted) setState(() => _error = ApiClient.getErrorMessage(error));
    }
  }

  Future<void> _updateStatus(String id, String status) async {
    try {
      await context.read<ApiClient>().patch('/api/organizations/$id', data: {'status': status});
      await _load();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Status diperbarui')));
      }
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(ApiClient.getErrorMessage(error))));
      }
    }
  }

  void _showForm() {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (ctx) => _OrganizationForm(regions: _regions ?? [], onSaved: _load),
    );
  }

  @override
  Widget build(BuildContext context) {
    final rows = (_rows ?? []).where((row) {
      if (_query.isEmpty) return true;
      return jsonEncode(row).toLowerCase().contains(_query.toLowerCase());
    }).toList();

    return AdminShell(
      title: 'Organisasi',
      actions: [
        IconButton(icon: const Icon(Icons.add), onPressed: _showForm),
      ],
      child: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 10, 16, 100),
          children: [
            TextField(
              onChanged: (value) => setState(() => _query = value),
              decoration: const InputDecoration(
                hintText: 'Cari organisasi...',
                prefixIcon: Icon(Icons.search_rounded),
              ),
            ),
            const SizedBox(height: 16),
            if (_rows == null && _error == null)
              const SkeletonListTile()
            else if (_error != null)
              Center(child: Text(_error!))
            else if (rows.isEmpty)
              const Center(child: Padding(padding: EdgeInsets.only(top: 80), child: Text('Belum ada organisasi.')))
            else
              for (final raw in rows)
                Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: _OrgCard(
                    row: raw as Map<String, dynamic>,
                    onStatusChange: (status) => _updateStatus(raw['id'], status),
                  ),
                ),
          ],
        ),
      ),
    );
  }
}

class _OrgCard extends StatelessWidget {
  const _OrgCard({required this.row, required this.onStatusChange});
  final Map<String, dynamic> row;
  final ValueChanged<String> onStatusChange;

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
                    Text(row['name'] ?? '', style: const TextStyle(fontWeight: FontWeight.bold)),
                    const SizedBox(height: 4),
                    Text('${row['type']} · ${row['region']?['name'] ?? 'No region'}', style: const TextStyle(color: ReLoopColors.muted, fontSize: 12)),
                  ],
                ),
              ),
              StatusBadge(statusKey: row['status'] ?? ''),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text('Mesin: ${row['machineCount'] ?? 0} | User: ${row['userCount'] ?? 0}', style: const TextStyle(fontSize: 12)),
              DropdownButton<String>(
                value: row['status'] ?? 'ACTIVE',
                items: const [
                  DropdownMenuItem(value: 'ACTIVE', child: Text('ACTIVE')),
                  DropdownMenuItem(value: 'INACTIVE', child: Text('INACTIVE')),
                  DropdownMenuItem(value: 'SUSPENDED', child: Text('SUSPENDED')),
                ],
                onChanged: (val) {
                  if (val != null && val != row['status']) onStatusChange(val);
                },
                isDense: true,
                underline: const SizedBox(),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _OrganizationForm extends StatefulWidget {
  const _OrganizationForm({required this.regions, required this.onSaved});
  final List<dynamic> regions;
  final VoidCallback onSaved;

  @override
  State<_OrganizationForm> createState() => _OrganizationFormState();
}

class _OrganizationFormState extends State<_OrganizationForm> {
  final _name = TextEditingController();
  final _address = TextEditingController();
  final _contactName = TextEditingController();
  final _contactPhone = TextEditingController();
  String _type = 'OTHER';
  String? _regionId;
  bool _saving = false;

  final _types = ["SCHOOL", "CAMPUS", "VILLAGE", "TOURISM_SITE", "OFFICE", "COMMUNITY", "WASTE_BANK", "OTHER"];

  Future<void> _save() async {
    if (_name.text.isEmpty) return;
    setState(() => _saving = true);
    try {
      await context.read<ApiClient>().post('/api/organizations', data: {
        'name': _name.text,
        'type': _type,
        if (_regionId != null) 'regionId': _regionId,
        if (_address.text.isNotEmpty) 'address': _address.text,
        if (_contactName.text.isNotEmpty) 'contactName': _contactName.text,
        if (_contactPhone.text.isNotEmpty) 'contactPhone': _contactPhone.text,
      });
      widget.onSaved();
      if (mounted) Navigator.pop(context);
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(ApiClient.getErrorMessage(e))));
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
          const Text('Tambah Organisasi', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
          const SizedBox(height: 16),
          TextField(controller: _name, decoration: const InputDecoration(labelText: 'Nama', border: OutlineInputBorder())),
          const SizedBox(height: 12),
          DropdownButtonFormField<String>(
            value: _type,
            items: _types.map((t) => DropdownMenuItem(value: t, child: Text(t))).toList(),
            onChanged: (v) => setState(() => _type = v!),
            decoration: const InputDecoration(labelText: 'Tipe', border: OutlineInputBorder()),
          ),
          const SizedBox(height: 12),
          DropdownButtonFormField<String?>(
            value: _regionId,
            items: [
              const DropdownMenuItem(value: null, child: Text('- Pilih Wilayah -')),
              ...widget.regions.map((r) => DropdownMenuItem(value: r['id'] as String, child: Text(r['name']))),
            ],
            onChanged: (v) => setState(() => _regionId = v),
            decoration: const InputDecoration(labelText: 'Wilayah', border: OutlineInputBorder()),
          ),
          const SizedBox(height: 12),
          TextField(controller: _address, decoration: const InputDecoration(labelText: 'Alamat', border: OutlineInputBorder())),
          const SizedBox(height: 12),
          TextField(controller: _contactName, decoration: const InputDecoration(labelText: 'Nama Kontak', border: OutlineInputBorder())),
          const SizedBox(height: 12),
          TextField(controller: _contactPhone, decoration: const InputDecoration(labelText: 'Telp Kontak', border: OutlineInputBorder())),
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
