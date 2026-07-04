import { Layout } from './components/Layout';
import { PropertyProvider } from './app/PropertyContext';

export default function App() {
  return (
    <PropertyProvider>
      <Layout />
    </PropertyProvider>
  );
}
