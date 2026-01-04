# Rekognition Moderation Labels Reference

## Actual Rekognition Moderation Labels

Based on AWS documentation, here are the **actual** labels that Rekognition returns:

### Violence & Weapons
- `Violence` ✅ (This exists)
- `Guns` ✅ (This exists - not "Weapons")
- `Knives` ✅ (This exists)
- `Explosives` ✅ (This exists)

### Explicit Content
- `Explicit Nudity` ✅ (This exists)
- `Rude Gestures` ✅ (This exists)
- `Adult Content` ✅ (This exists)

### Disturbing Content
- `Visually Disturbing` ✅ (This exists)
- `Hate Symbols` ✅ (This exists)

### Substances
- `Drugs` ✅ (This exists)
- `Tobacco` ✅ (This exists)
- `Alcohol` ✅ (This exists)

### Other
- `Gambling` ✅ (This exists)

## Issues in Current Code

### ❌ Non-existent Labels
- `"Real Violence"` - This label doesn't exist
- `"Weapons"` - Should be `"Guns"` instead
- `"Gore"` - This might not be a standard label

### ✅ Correct Labels
- `"Explicit Nudity"` - Correct
- `"Visually Disturbing"` - Correct
- `"Hate Symbols"` - Correct
- `"Gambling"` - Correct
- `"Drugs"` - Correct
- `"Tobacco"` - Correct
- `"Alcohol"` - Correct
- `"Rude Gestures"` - Correct
- `"Adult Content"` - Correct
- `"Violence"` - Correct

## Suggested Corrections

### Update the blockedContentLabels array:

```typescript
const blockedContentLabels = [
  'Explicit Nudity',
  'Visually Disturbing', 
  'Hate Symbols',
  'Gambling',
  'Drugs',
  'Tobacco',
  'Alcohol',
  'Rude Gestures',
  'Adult Content',
  // Remove: 'Gore', 'Real Violence'
  // Add: 'Guns', 'Knives', 'Explosives' (if you want to block weapons)
];
```

### Update the allowedGameContentLabels array:

```typescript
const allowedGameContentLabels = [
  'Violence', // Game violence is acceptable
  // Remove: 'Weapons' (doesn't exist)
  // Add: 'Guns', 'Knives', 'Explosives' if you want to allow game weapons
];
```

## Testing Strategy

1. **Test with safe images** - Should return no labels
2. **Test with weapon images** - Should detect `Guns`, `Knives`, etc.
3. **Test with violence images** - Should detect `Violence`
4. **Test with Star Citizen screenshots** - Should allow game content

## Running the Test

```bash
# Build first
yarn build

# Test with a sample image
node test-rekognition-labels.js /path/to/test-image.jpg

# Test with a Star Citizen screenshot
node test-rekognition-labels.js /path/to/star-citizen-screenshot.png
```

## Expected Results for Star Citizen

- **Spaceship combat**: Should detect `Violence` but pass (game content)
- **Weapon screenshots**: Should detect `Guns` but pass (game content)
- **Safe screenshots**: Should pass with no labels
- **Inappropriate content**: Should be blocked regardless of context
