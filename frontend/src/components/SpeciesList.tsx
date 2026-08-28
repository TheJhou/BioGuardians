import { useState, useEffect, useCallback } from 'react';
import { api } from '../api/client.js';
import type { Especie, EspecieBusca, Bioma, Categoria } from '../types/index.js';

interface SpeciesListProps {
  filters: { categoria?: string; bioma?: number; estado?: string; busca?: string };
  onSelectEspecie: (id: number) => void;
  onEditEspecie: (especie: Especie) => void;
  onAddEspecie: () => void;
}

export default function SpeciesList({ filters, onSelectEspecie, onEditEspecie, onAddEspecie }: SpeciesListProps) {
  const [especies, setEspecies] = useState<Especie[] | EspecieBusca[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [biomas, setBiomas] = useState<Bioma[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [data, biomaData, catData] = await Promise.all([
        api.getEspecies(filters),
        api.getBiomas(),
        api.getCategorias(),
      ]);
      setEspecies(data);
      setBiomas(biomaData);
      setCategorias(catData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load species');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async (id: number, nome: string) => {
    if (!confirm(`Delete species "${nome}"? This will also delete all its occurrences.`)) return;
    try {
      await api.deleteEspecie(id);
      load();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  if (loading) return <div className="loading">Loading species...</div>;
  if (error) return <div className="error">Error: {error}</div>;

  return (
    <div className="species-list">
      <div className="list-header">
        <h2>Species ({especies.length})</h2>
        <button className="btn btn-primary" onClick={onAddEspecie}>+ Add Species</button>
      </div>

      {especies.length === 0 ? (
        <p className="empty-state">No species found with current filters.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Scientific Name</th>
              <th>Popular Name</th>
              <th>Category</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {especies.map((esp) => {
              const id = 'especie_id' in esp ? esp.especie_id : esp.id;
              const nome = esp.nome_cientifico;
              const popular = esp.nome_popular;
              const cat = 'categoria' in esp ? esp.categoria : (esp as Especie).categoria_ameaca;
              const status = 'status' in esp ? esp.status : 'ativo';
              return (
                <tr key={id}>
                  <td className="scientific-name" onClick={() => onSelectEspecie(id)}>
                    {nome}
                  </td>
                  <td>{popular || '-'}</td>
                  <td>
                    <span className={`cat-badge cat-${cat.toLowerCase()}`}>{cat}</span>
                  </td>
                  <td>{status}</td>
                  <td className="actions">
                    <button className="btn btn-sm" onClick={() => onSelectEspecie(id)}>Map</button>
                    <button className="btn btn-sm" onClick={() => onEditEspecie(esp as Especie)}>Edit</button>
                    <button className="btn btn-sm btn-danger" onClick={() => handleDelete(id, nome)}>Delete</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
