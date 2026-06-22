import 'package:flutter/material.dart';

import 'api_client.dart';
import 'models.dart';
import 'theme.dart';

class AuthScreen extends StatefulWidget {
  const AuthScreen({super.key, required this.api, required this.onSignedIn});

  final ApiClient api;
  final ValueChanged<AppUser> onSignedIn;

  @override
  State<AuthScreen> createState() => _AuthScreenState();
}

class _AuthScreenState extends State<AuthScreen> {
  final _formKey = GlobalKey<FormState>();
  final _name = TextEditingController();
  final _email = TextEditingController();
  final _phone = TextEditingController();
  final _password = TextEditingController();
  bool _register = false;
  bool _busy = false;
  bool _obscure = true;
  String? _error;

  @override
  void dispose() {
    _name.dispose();
    _email.dispose();
    _phone.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final body = <String, dynamic>{
        'email': _email.text.trim(),
        'password': _password.text,
        if (_register) 'name': _name.text.trim(),
        if (_register) 'phone': _phone.text.trim(),
      };
      await widget.api.post(
        _register ? '/api/auth/register' : '/api/auth/login',
        body,
      );
      final me = await widget.api.get('/api/auth/me');
      widget.onSignedIn(AppUser.fromJson(me['user'] as Map<String, dynamic>));
    } on ApiException catch (error) {
      if (mounted) setState(() => _error = error.message);
    } catch (_) {
      if (mounted) {
        setState(() => _error = 'Tidak dapat menghubungi server ReLoop.');
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _serverDialog() async {
    final controller = TextEditingController(text: widget.api.baseUrl);
    final result = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Alamat server'),
        content: TextField(
          controller: controller,
          keyboardType: TextInputType.url,
          decoration: const InputDecoration(
            hintText: 'https://reloop.example.com',
            helperText: 'Android emulator lokal: http://10.0.2.2:3000',
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Batal'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, controller.text),
            child: const Text('Simpan'),
          ),
        ],
      ),
    );
    controller.dispose();
    if (result != null) {
      try {
        await widget.api.setBaseUrl(result);
        if (mounted) setState(() => _error = null);
      } on ApiException catch (error) {
        if (mounted) setState(() => _error = error.message);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: LayoutBuilder(
          builder: (context, constraints) {
            final wide = constraints.maxWidth >= 720;
            final form = _buildForm();
            return Center(
              child: SingleChildScrollView(
                padding: const EdgeInsets.all(24),
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 980),
                  child: wide
                      ? Row(
                          children: [
                            const Expanded(child: _AuthIntro()),
                            const SizedBox(width: 48),
                            Expanded(child: form),
                          ],
                        )
                      : Column(
                          children: [
                            const _AuthIntro(compact: true),
                            const SizedBox(height: 28),
                            form,
                          ],
                        ),
                ),
              ),
            );
          },
        ),
      ),
    );
  }

  Widget _buildForm() => Card(
    child: Padding(
      padding: const EdgeInsets.all(24),
      child: Form(
        key: _formKey,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              _register ? 'Buat akun pengguna' : 'Masuk ke ReLoop',
              style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w800),
            ),
            const SizedBox(height: 20),
            if (_register) ...[
              TextFormField(
                controller: _name,
                textInputAction: TextInputAction.next,
                decoration: const InputDecoration(
                  labelText: 'Nama lengkap',
                  prefixIcon: Icon(Icons.person_outline),
                ),
                validator: (value) =>
                    (value?.trim().length ?? 0) < 2 ? 'Nama wajib diisi' : null,
              ),
              const SizedBox(height: 14),
              TextFormField(
                controller: _phone,
                keyboardType: TextInputType.phone,
                textInputAction: TextInputAction.next,
                decoration: const InputDecoration(
                  labelText: 'Nomor HP',
                  prefixIcon: Icon(Icons.phone_outlined),
                ),
                validator: (value) => (value?.trim().length ?? 0) < 9
                    ? 'Nomor HP tidak valid'
                    : null,
              ),
              const SizedBox(height: 14),
            ],
            TextFormField(
              controller: _email,
              keyboardType: TextInputType.emailAddress,
              textInputAction: TextInputAction.next,
              decoration: const InputDecoration(
                labelText: 'Email',
                prefixIcon: Icon(Icons.email_outlined),
              ),
              validator: (value) => value != null && value.contains('@')
                  ? null
                  : 'Email tidak valid',
            ),
            const SizedBox(height: 14),
            TextFormField(
              controller: _password,
              obscureText: _obscure,
              onFieldSubmitted: (_) => _submit(),
              decoration: InputDecoration(
                labelText: 'Password',
                prefixIcon: const Icon(Icons.lock_outline),
                suffixIcon: IconButton(
                  onPressed: () => setState(() => _obscure = !_obscure),
                  icon: Icon(
                    _obscure
                        ? Icons.visibility_outlined
                        : Icons.visibility_off_outlined,
                  ),
                ),
              ),
              validator: (value) => (value?.length ?? 0) < (_register ? 6 : 1)
                  ? 'Password minimal ${_register ? 6 : 1} karakter'
                  : null,
            ),
            if (_error != null) ...[
              const SizedBox(height: 14),
              Text(_error!, style: const TextStyle(color: Colors.red)),
            ],
            const SizedBox(height: 20),
            FilledButton.icon(
              onPressed: _busy ? null : _submit,
              icon: _busy
                  ? const SizedBox.square(
                      dimension: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.login),
              label: Text(_register ? 'Daftar' : 'Masuk'),
            ),
            TextButton(
              onPressed: _busy
                  ? null
                  : () => setState(() {
                      _register = !_register;
                      _error = null;
                    }),
              child: Text(
                _register
                    ? 'Sudah punya akun? Masuk'
                    : 'Belum punya akun? Daftar',
              ),
            ),
            const Divider(),
            TextButton.icon(
              onPressed: _serverDialog,
              icon: const Icon(Icons.dns_outlined),
              label: Text('Server: ${widget.api.baseUrl}'),
            ),
          ],
        ),
      ),
    ),
  );
}

class _AuthIntro extends StatelessWidget {
  const _AuthIntro({this.compact = false});
  final bool compact;

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    mainAxisSize: MainAxisSize.min,
    children: [
      const Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.recycling_rounded, size: 54, color: brandGreen),
          SizedBox(width: 12),
          Text(
            'ReLoop',
            style: TextStyle(fontSize: 34, fontWeight: FontWeight.w900),
          ),
        ],
      ),
      if (!compact) ...[
        const SizedBox(height: 24),
        const Text(
          'Sampah kembali bernilai.',
          style: TextStyle(fontSize: 36, fontWeight: FontWeight.w800),
        ),
        const SizedBox(height: 12),
        Text(
          'Setor sampah, pantau mesin, kelola pickup, dan cairkan reward dari satu aplikasi.',
          style: TextStyle(
            fontSize: 17,
            height: 1.5,
            color: Colors.grey.shade700,
          ),
        ),
      ],
    ],
  );
}
