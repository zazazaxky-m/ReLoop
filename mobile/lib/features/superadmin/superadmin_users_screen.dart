import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/api_client.dart';
import '../../shared/widgets/reloop_card.dart';
import '../../shared/widgets/skeleton_loading.dart';
import '../../shared/widgets/status_badge.dart';
import '../../theme/colors.dart';
import '../admin/admin_shell.dart';

class SuperadminUsersScreen extends StatefulWidget {
  const SuperadminUsersScreen({super.key});

  @override
  State<SuperadminUsersScreen> createState() => _SuperadminUsersScreenState();
}

class _SuperadminUsersScreenState extends State<SuperadminUsersScreen> {
  List<dynamic>? _rows;
  List<dynamic>? _organizations;
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
      final resUser = await api.get('/api/users');
      final resOrg = await api.get('/api/organizations');
      
      if (mounted) {
        setState(() {
          _rows = (resUser.data['users'] as List?) ?? [];
          _organizations = (resOrg.data['organizations'] as List?) ?? [];
        });
      }
    } catch (error) {
      if (mounted) setState(() => _error = ApiClient.getErrorMessage(error));
    }
  }

  Future<void> _update(String id, Map<String, dynamic> data) async {
    try {
      await context.read<ApiClient>().patch('/api/users/$id', data: data);
      await _load();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Perubahan berhasil disimpan')));
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
      builder: (ctx) => _UserForm(organizations: _organizations ?? [], onSaved: _load),
    );
  }

  @override
  Widget build(BuildContext context) {
    final rows = (_rows ?? []).where((row) {
      if (_query.isEmpty) return true;
      return jsonEncode(row).toLowerCase().contains(_query.toLowerCase());
    }).toList();

    return AdminShell(
      title: 'Pengguna & Peran',
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
                hintText: 'Cari pengguna...',
                prefixIcon: Icon(Icons.search_rounded),
              ),
            ),
            const SizedBox(height: 16),
            if (_rows == null && _error == null)
              const SkeletonListTile()
            else if (_error != null)
              Center(child: Text(_error!))
            else if (rows.isEmpty)
              const Center(child: Padding(padding: EdgeInsets.only(top: 80), child: Text('Belum ada pengguna.')))
            else
              for (final raw in rows)
                Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: _UserCard(
                    row: raw as Map<String, dynamic>,
                    onUpdate: (data) => _update(raw['id'], data),
                  ),
                ),
          ],
        ),
      ),
    );
  }
}

class _UserCard extends StatelessWidget {
  const _UserCard({required this.row, required this.onUpdate});
  final Map<String, dynamic> row;
  final ValueChanged<Map<String, dynamic>> onUpdate;

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
                    Text('${row['email']} · ${row['organization']?['name'] ?? 'No organization'}', style: const TextStyle(color: ReLoopColors.muted, fontSize: 12)),
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
              DropdownButton<String>(
                value: row['role'] ?? 'USER',
                items: const [
                  DropdownMenuItem(value: 'SUPERADMIN', child: Text('SUPERADMIN')),
                  DropdownMenuItem(value: 'ADMIN', child: Text('ADMIN')),
                  DropdownMenuItem(value: 'PENGEPUL', child: Text('PENGEPUL')),
                  DropdownMenuItem(value: 'USER', child: Text('USER')),
                ],
                onChanged: (val) {
                  if (val != null && val != row['role']) onUpdate({'role': val});
                },
                isDense: true,
                underline: const SizedBox(),
                style: const TextStyle(fontSize: 13, color: ReLoopColors.foreground),
              ),
              DropdownButton<String>(
                value: row['status'] ?? 'ACTIVE',
                items: const [
                  DropdownMenuItem(value: 'ACTIVE', child: Text('ACTIVE')),
                  DropdownMenuItem(value: 'INACTIVE', child: Text('INACTIVE')),
                  DropdownMenuItem(value: 'SUSPENDED', child: Text('SUSPENDED')),
                ],
                onChanged: (val) {
                  if (val != null && val != row['status']) onUpdate({'status': val});
                },
                isDense: true,
                underline: const SizedBox(),
                style: const TextStyle(fontSize: 13, color: ReLoopColors.foreground),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _UserForm extends StatefulWidget {
  const _UserForm({required this.organizations, required this.onSaved});
  final List<dynamic> organizations;
  final VoidCallback onSaved;

  @override
  State<_UserForm> createState() => _UserFormState();
}

class _UserFormState extends State<_UserForm> {
  final _name = TextEditingController();
  final _email = TextEditingController();
  final _password = TextEditingController();
  final _phone = TextEditingController();
  String _role = 'USER';
  String? _organizationId;
  bool _saving = false;

  final _roles = ["SUPERADMIN", "ADMIN", "PENGEPUL", "USER"];

  Future<void> _save() async {
    if (_name.text.isEmpty || _email.text.isEmpty || _password.text.isEmpty) return;
    setState(() => _saving = true);
    try {
      await context.read<ApiClient>().post('/api/users', data: {
        'name': _name.text,
        'email': _email.text,
        'password': _password.text,
        'role': _role,
        if (_organizationId != null) 'organizationId': _organizationId,
        if (_phone.text.isNotEmpty) 'phone': _phone.text,
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
          const Text('Tambah Pengguna', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
          const SizedBox(height: 16),
          TextField(controller: _name, decoration: const InputDecoration(labelText: 'Nama', border: OutlineInputBorder())),
          const SizedBox(height: 12),
          TextField(controller: _email, keyboardType: TextInputType.emailAddress, decoration: const InputDecoration(labelText: 'Email', border: OutlineInputBorder())),
          const SizedBox(height: 12),
          TextField(controller: _password, obscureText: true, decoration: const InputDecoration(labelText: 'Password', border: OutlineInputBorder())),
          const SizedBox(height: 12),
          DropdownButtonFormField<String>(
            value: _role,
            items: _roles.map((r) => DropdownMenuItem(value: r, child: Text(r))).toList(),
            onChanged: (v) => setState(() => _role = v!),
            decoration: const InputDecoration(labelText: 'Peran', border: OutlineInputBorder()),
          ),
          const SizedBox(height: 12),
          DropdownButtonFormField<String?>(
            value: _organizationId,
            items: [
              const DropdownMenuItem(value: null, child: Text('- Tidak ada -')),
              ...widget.organizations.map((o) => DropdownMenuItem(value: o['id'] as String, child: Text(o['name']))),
            ],
            onChanged: (v) => setState(() => _organizationId = v),
            decoration: const InputDecoration(labelText: 'Organisasi (wajib untuk Admin)', border: OutlineInputBorder()),
          ),
          const SizedBox(height: 12),
          TextField(controller: _phone, keyboardType: TextInputType.phone, decoration: const InputDecoration(labelText: 'Telepon', border: OutlineInputBorder())),
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
