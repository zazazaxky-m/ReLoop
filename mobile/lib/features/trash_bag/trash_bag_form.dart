import 'dart:io';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:image_cropper/image_cropper.dart';
import 'package:provider/provider.dart';
import '../../core/api_client.dart';
import '../../core/models/trash_bag.dart';
import '../../shared/widgets/reloop_button.dart';
import '../../theme/colors.dart';
import 'package:dio/dio.dart';

class TrashBagForm extends StatefulWidget {
  const TrashBagForm({super.key});

  @override
  State<TrashBagForm> createState() => _TrashBagFormState();
}

class _TrashBagFormState extends State<TrashBagForm> {
  final _formKey = GlobalKey<FormState>();
  final _notesCtrl = TextEditingController();

  List<WasteType> _wasteTypes = [];
  WasteType? _selectedWasteType;
  XFile? _imageFile;
  CroppedFile? _croppedFile;
  int _quantity = 1;
  bool _isSubmitting = false;
  bool _isLoadingTypes = true;

  @override
  void initState() {
    super.initState();
    _loadWasteTypes();
  }

  @override
  void dispose() {
    _notesCtrl.dispose();
    super.dispose();
  }

  Future<void> _loadWasteTypes() async {
    try {
      final api = context.read<ApiClient>();
      final response = await api.get('/api/waste-types');
      final data = response.data as Map<String, dynamic>;
      setState(() {
        _wasteTypes = (data['wasteTypes'] as List? ?? [])
            .map((e) => WasteType.fromJson(e as Map<String, dynamic>))
            .toList();
        _isLoadingTypes = false;
      });
    } catch (_) {
      setState(() => _isLoadingTypes = false);
    }
  }

  Future<void> _pickImage(ImageSource source) async {
    final picker = ImagePicker();
    final image = await picker.pickImage(source: source, imageQuality: 85);
    if (image == null) return;

    final cropped = await ImageCropper().cropImage(
      sourcePath: image.path,
      aspectRatio: const CropAspectRatio(ratioX: 4, ratioY: 3),
      uiSettings: [
        AndroidUiSettings(
          toolbarTitle: 'Crop Foto',
          toolbarColor: const Color(0xFF16A34A),
          toolbarWidgetColor: const Color(0xFFFFFFFF),
          lockAspectRatio: false,
        ),
        IOSUiSettings(title: 'Crop Foto'),
      ],
    );

    setState(() {
      _imageFile = image;
      if (cropped != null) _croppedFile = cropped;
    });
  }

  void _showImagePickerOpts() {
    showModalBottomSheet(
      context: context,
      builder: (context) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Text(
                'Ambil Foto Sampah',
                style: TextStyle(fontWeight: FontWeight.w700, fontSize: 16),
              ),
              const SizedBox(height: 20),
              ListTile(
                leading: const Icon(Icons.camera_alt, color: ReLoopColors.brand500),
                title: const Text('Kamera'),
                onTap: () {
                  Navigator.pop(context);
                  _pickImage(ImageSource.camera);
                },
              ),
              ListTile(
                leading: const Icon(Icons.photo_library, color: ReLoopColors.brand500),
                title: const Text('Gallery'),
                onTap: () {
                  Navigator.pop(context);
                  _pickImage(ImageSource.gallery);
                },
              ),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;

    if (_selectedWasteType == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Pilih jenis sampah')),
      );
      return;
    }

    if (_imageFile == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Ambil foto sampah terlebih dahulu')),
      );
      return;
    }

    setState(() => _isSubmitting = true);

    try {
      final api = context.read<ApiClient>();

      final filePath = _croppedFile?.path ?? _imageFile!.path;
      final fileName = filePath.split('/').last;

      final formData = FormData.fromMap({
        'wasteTypeId': _selectedWasteType!.id,
        'quantity': _quantity.toString(),
        'notes': _notesCtrl.text.trim(),
        'photo': await MultipartFile.fromFile(filePath, filename: fileName),
      });

      await api.dio.post('/api/trash-bags', data: formData);

      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Trash bag berhasil disubmit!'),
          backgroundColor: ReLoopColors.success,
        ),
      );
      Navigator.pop(context);
    } on DioException catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(ApiClient.getErrorMessage(e)),
            backgroundColor: ReLoopColors.danger,
          ),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Gagal submit trash bag'),
            backgroundColor: ReLoopColors.danger,
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _isSubmitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Submit Trash Bag')),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Form(
          key: _formKey,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              GestureDetector(
                onTap: _showImagePickerOpts,
                child: Container(
                  width: double.infinity,
                  height: 200,
                  decoration: BoxDecoration(
                    color: ReLoopColors.background,
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(
                      color: ReLoopColors.border,
                      style: BorderStyle.solid,
                      width: 2,
                    ),
                  ),
                  child: _imageFile != null
                      ? ClipRRect(
                          borderRadius: BorderRadius.circular(10),
                          child: Image.file(
                            File(_croppedFile?.path ?? _imageFile!.path),
                            fit: BoxFit.cover,
                          ),
                        )
                      : Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Container(
                              width: 48,
                              height: 48,
                              decoration: BoxDecoration(
                                color: ReLoopColors.brand50,
                                borderRadius: BorderRadius.circular(12),
                              ),
                              child: const Icon(
                                Icons.camera_alt,
                                color: ReLoopColors.brand500,
                                size: 24,
                              ),
                            ),
                            const SizedBox(height: 12),
                            const Text(
                              'Ambil foto sampah',
                              style: TextStyle(
                                color: ReLoopColors.muted,
                                fontSize: 14,
                                fontWeight: FontWeight.w500,
                              ),
                            ),
                            const SizedBox(height: 4),
                            const Text(
                              'Pastikan sampah terlihat jelas',
                              style: TextStyle(
                                color: ReLoopColors.mutedSoft,
                                fontSize: 12,
                              ),
                            ),
                          ],
                        ),
                ),
              ),
              if (_imageFile != null) ...[
                const SizedBox(height: 8),
                TextButton.icon(
                  onPressed: _showImagePickerOpts,
                  icon: const Icon(Icons.refresh, size: 16),
                  label: const Text('Ganti Foto'),
                ),
              ],
              const SizedBox(height: 20),
              const Text(
                'Jenis Sampah',
                style: TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w600,
                  color: ReLoopColors.foreground,
                ),
              ),
              const SizedBox(height: 8),
              if (_isLoadingTypes)
                const Center(child: CircularProgressIndicator())
              else if (_wasteTypes.isEmpty)
                const Text('Tidak ada jenis sampah tersedia',
                    style: TextStyle(color: ReLoopColors.mutedSoft))
              else
                DropdownButtonFormField<WasteType>(
                  value: _selectedWasteType,
                  decoration: const InputDecoration(
                    hintText: 'Pilih jenis sampah',
                    prefixIcon: Icon(Icons.recycling),
                  ),
                  items: _wasteTypes.map((wt) {
                    return DropdownMenuItem<WasteType>(
                      value: wt,
                      child: Text(wt.name),
                    );
                  }).toList(),
                  onChanged: (v) => setState(() => _selectedWasteType = v),
                  validator: (v) => v == null ? 'Pilih jenis sampah' : null,
                ),
              const SizedBox(height: 20),
              Row(
                children: [
                  const Text(
                    'Jumlah (karung)',
                    style: TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.w600,
                      color: ReLoopColors.foreground,
                    ),
                  ),
                  const Spacer(),
                  Container(
                    decoration: BoxDecoration(
                      border: Border.all(color: ReLoopColors.border),
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        IconButton(
                          icon: const Icon(Icons.remove),
                          onPressed: _quantity > 1
                              ? () => setState(() => _quantity--)
                              : null,
                          iconSize: 20,
                        ),
                        SizedBox(
                          width: 40,
                          child: Text(
                            '$_quantity',
                            textAlign: TextAlign.center,
                            style: const TextStyle(
                              fontSize: 16,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ),
                        IconButton(
                          icon: const Icon(Icons.add),
                          onPressed: () => setState(() => _quantity++),
                          iconSize: 20,
                        ),
                      ],
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 20),
              TextFormField(
                controller: _notesCtrl,
                maxLines: 3,
                decoration: const InputDecoration(
                  labelText: 'Catatan (opsional)',
                  hintText: 'Misal: botol plastik bersih, kaleng, dll',
                  prefixIcon: Icon(Icons.notes),
                ),
              ),
              const SizedBox(height: 32),
              ReLoopButton(
                label: 'Submit Trash Bag',
                icon: Icons.send,
                onPressed: _isSubmitting ? null : _submit,
                isLoading: _isSubmitting,
                size: ReLoopButtonSize.lg,
              ),
              const SizedBox(height: 80),
            ],
          ),
        ),
      ),
    );
  }
}
