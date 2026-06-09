# Handling fractional values in Quantity

_How to preserve human-readable fractional dosing (e.g. "1/2 tablet") alongside the machine value. See [#64](https://github.com/jwilleke/yourphr/issues/64)._

## The problem

FHIR `Quantity.value` is a **decimal** — so "half a tablet" is stored as `Quantity.value = 0.5`. That's correct for computation, but `0.5 tablet` loses the way a clinician/patient actually wrote it ("1/2 tablet", "½ tab"), which matters for a patient-facing record.

## The guidance

For patient-facing cases where the **original fractional rendering must be preserved alongside** the required decimal, use the standard **[rendered-value extension](https://build.fhir.org/ig/HL7/fhir-extensions/StructureDefinition-rendered-value.html)** (`http://hl7.org/fhir/StructureDefinition/rendered-value`):

```jsonc
{
  "value": 0.5,
  "unit": "tablet",
  "extension": [
    {
      "url": "http://hl7.org/fhir/StructureDefinition/rendered-value",
      "valueString": "1/2 tablet"
    }
  ]
}
```

- `value` (`0.5`) stays authoritative for any calculation.
- `rendered-value.valueString` (`"1/2 tablet"`) carries the human-readable form to show the patient.

> There is an active HL7 ticket to expand `rendered-value` to support the `Ratio` data type in the future.

## How this applies to YourPHR

YourPHR **displays** imported data. When rendering a `Quantity` (medication dose, observation value, etc.):

- **Prefer `rendered-value` when present** — show its `valueString` as the human-readable quantity, so a record that supplied "1/2 tablet" displays that way rather than "0.5 tablet."
- **Otherwise format `value` + `unit`** as today.
- **No guessing** — do not _invent_ a fraction from a decimal (e.g. don't turn `0.5` into "1/2" ourselves). Only show a fractional rendering when the source supplied one via the extension. Absent both, show the decimal.

This is a display-layer enhancement to the shared Quantity rendering; capturing the approach here so it's consistent wherever a `Quantity` is shown.

## References

- FHIR [rendered-value extension](https://build.fhir.org/ig/HL7/fhir-extensions/StructureDefinition-rendered-value.html)
- FHIR R4 [Quantity](https://hl7.org/fhir/r4/datatypes.html#Quantity)
