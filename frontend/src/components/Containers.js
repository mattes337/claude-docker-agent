import React, { useState, useEffect } from 'react';
import { Trash2, Server, AlertCircle, CheckCircle, Clock, Container } from 'lucide-react';

const Containers = ({ loadContainers, removeContainer }) => {
  const [containers, setContainers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [removing, setRemoving] = useState(new Set());

  useEffect(() => {
    loadContainerData();
  }, []);

  const loadContainerData = async () => {
    setLoading(true);
    try {
      const result = await loadContainers();
      if (result.success) {
        setContainers(result.containers);
      }
    } catch (error) {
      console.error('Failed to load containers:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveContainer = async (containerId) => {
    if (!window.confirm('Are you sure you want to remove this container?')) {
      return;
    }

    setRemoving(prev => new Set(prev).add(containerId));
    
    try {
      const result = await removeContainer(containerId);
      if (result.success) {
        // Remove from local state
        setContainers(prev => prev.filter(c => c.id !== containerId));
      } else {
        alert('Failed to remove container: ' + result.error);
      }
    } catch (error) {
      console.error('Failed to remove container:', error);
      alert('Failed to remove container: ' + error.message);
    } finally {
      setRemoving(prev => {
        const newSet = new Set(prev);
        newSet.delete(containerId);
        return newSet;
      });
    }
  };

  const getStateIcon = (state) => {
    switch (state) {
      case 'running':
        return <CheckCircle size={16} className="text-green-500" />;
      case 'exited':
        return <AlertCircle size={16} className="text-gray-500" />;
      case 'created':
        return <Clock size={16} className="text-blue-500" />;
      default:
        return <Server size={16} className="text-gray-400" />;
    }
  };

  const formatDate = (date) => {
    return new Date(date).toLocaleString();
  };

  if (loading) {
    return (
      <div className="containers-loading">
        <div className="loading-spinner"></div>
        <p>Loading containers...</p>
      </div>
    );
  }

  return (
    <div className="containers">
      <div className="containers-header">
        <h2>
          <Container size={20} />
          Docker Containers ({containers.length})
        </h2>
        <button onClick={loadContainerData} className="btn btn-secondary">
          Refresh
        </button>
      </div>

      {containers.length === 0 ? (
        <div className="no-containers">
          <Container size={48} />
          <p>No containers found</p>
          <small>Docker containers will appear here once you create sessions</small>
        </div>
      ) : (
        <div className="containers-list">
          {containers.map(container => (
            <div key={container.id} className="container-item">
              <div className="container-header">
                <div className="container-info">
                  <div className="container-name">
                    {getStateIcon(container.state)}
                    <span>{container.name}</span>
                  </div>
                  <div className="container-status">
                    <span className={`status-badge status-${container.state}`}>
                      {container.state}
                    </span>
                    {!container.hasSession && (
                      <span className="status-badge status-orphaned">
                        orphaned
                      </span>
                    )}
                  </div>
                </div>
                <div className="container-actions">
                  <button
                    onClick={() => handleRemoveContainer(container.id)}
                    disabled={removing.has(container.id)}
                    className="btn btn-danger btn-sm"
                    title="Remove container"
                  >
                    {removing.has(container.id) ? (
                      <div className="spinner" />
                    ) : (
                      <Trash2 size={14} />
                    )}
                  </button>
                </div>
              </div>

              <div className="container-details">
                <div className="container-meta">
                  <div className="meta-item">
                    <strong>ID:</strong> 
                    <code>{container.id.substring(0, 12)}</code>
                  </div>
                  <div className="meta-item">
                    <strong>Image:</strong> 
                    <span>{container.image}</span>
                  </div>
                  <div className="meta-item">
                    <strong>Created:</strong> 
                    <span>{formatDate(container.created)}</span>
                  </div>
                  <div className="meta-item">
                    <strong>Status:</strong> 
                    <span>{container.status}</span>
                  </div>
                </div>

                {container.sessionInfo && (
                  <div className="session-info">
                    <h4>Session Information</h4>
                    <div className="session-meta">
                      <div><strong>Name:</strong> {container.sessionInfo.name}</div>
                      <div><strong>Status:</strong> {container.sessionInfo.status}</div>
                      {container.sessionInfo.repoUrl && (
                        <div><strong>Repository:</strong> {container.sessionInfo.repoUrl}</div>
                      )}
                    </div>
                  </div>
                )}

                {!container.hasSession && (
                  <div className="orphaned-warning">
                    <AlertCircle size={16} />
                    <span>This container has no associated session metadata</span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default Containers;