import { Stack } from 'expo-router';
import { RequireProprietaire } from '../../components/RequireProprietaire';

export default function AdminLayout() {
  return (
    <RequireProprietaire>
      <Stack screenOptions={{ headerShown: false }} />
    </RequireProprietaire>
  );
}
