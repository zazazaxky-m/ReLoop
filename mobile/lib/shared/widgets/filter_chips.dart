import 'package:flutter/material.dart';
import '../../theme/colors.dart';

class ReLoopFilterChips extends StatelessWidget {
  final List<String> options;
  final String? selected;
  final ValueChanged<String?> onSelected;
  final String? label;

  const ReLoopFilterChips({
    super.key,
    required this.options,
    this.selected,
    required this.onSelected,
    this.label,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (label != null) ...[
          Text(
            label!,
            style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: context.reloopMuted),
          ),
          const SizedBox(height: 8),
        ],
        Wrap(
          spacing: 8,
          runSpacing: 6,
          children: [
            _buildChip(context, null, 'Semua'),
            ...options.map((o) => _buildChip(context, o, o)),
          ],
        ),
      ],
    );
  }

  Widget _buildChip(BuildContext context, String? value, String label) {
    final isSelected = value == selected;
    return GestureDetector(
      onTap: () => onSelected(value),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
        decoration: BoxDecoration(
          color: isSelected ? ReLoopColors.brand500 : context.reloopSurfaceSoft,
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: isSelected ? ReLoopColors.brand500 : context.reloopBorder),
        ),
        child: Text(
          label,
          style: TextStyle(
            color: isSelected ? Colors.white : context.reloopMuted,
            fontSize: 12,
            fontWeight: FontWeight.w600,
          ),
        ),
      ),
    );
  }
}
