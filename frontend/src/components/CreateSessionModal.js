import React, { useState } from 'react';
import { X, Github, GitBranch, Loader } from 'lucide-react';
import './CreateSessionModal.css';

const CreateSessionModal = ({ onClose, onCreateSession }) => {
  const [formData, setFormData] = useState({
    name: '',
    repoUrl: '',
    branch: 'main',
    newBranchName: ''
  });
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.name.trim()) {
      setError('Session name is required');
      return;
    }

    setIsCreating(true);
    setError('');

    try {
      const result = await onCreateSession({
        name: formData.name.trim(),
        repoUrl: formData.repoUrl.trim() || undefined,
        branch: formData.branch.trim() || 'main',
        newBranchName: formData.newBranchName.trim() || undefined
      });

      if (!result.success) {
        setError(result.error || 'Failed to create session');
        setIsCreating(false);
      }
      // If successful, the modal will be closed by the parent component
    } catch (error) {
      setError('Failed to create session');
      setIsCreating(false);
    }
  };

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    if (error) setError('');
  };

  const handleOverlayClick = (e) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div className="modal-overlay" onClick={handleOverlayClick}>
      <div className="modal">
        <div className="modal-header">
          <h2>Create New Session</h2>
          <button className="close-btn" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="modal-form">
          <div className="form-group">
            <label htmlFor="sessionName">Session Name *</label>
            <input
              id="sessionName"
              type="text"
              value={formData.name}
              onChange={(e) => handleChange('name', e.target.value)}
              placeholder="My Claude Session"
              required
              autoFocus
            />
          </div>

          <div className="form-group">
            <label htmlFor="repoUrl">
              <Github size={16} />
              Git Repository URL (optional)
            </label>
            <input
              id="repoUrl"
              type="url"
              value={formData.repoUrl}
              onChange={(e) => handleChange('repoUrl', e.target.value)}
              placeholder="https://github.com/user/repo.git"
            />
            <small className="form-help">
              Leave empty to start with an empty workspace
            </small>
          </div>

          <div className="form-group">
            <label htmlFor="branch">
              <GitBranch size={16} />
              Base Branch
            </label>
            <input
              id="branch"
              type="text"
              value={formData.branch}
              onChange={(e) => handleChange('branch', e.target.value)}
              placeholder="main"
            />
          </div>

          <div className="form-group">
            <label htmlFor="newBranchName">
              <GitBranch size={16} />
              New Branch Name (optional)
            </label>
            <input
              id="newBranchName"
              type="text"
              value={formData.newBranchName}
              onChange={(e) => handleChange('newBranchName', e.target.value)}
              placeholder="feature/my-changes"
            />
            <small className="form-help">
              Create and checkout a new branch from the base branch
            </small>
          </div>

          {error && (
            <div className="error-message">
              {error}
            </div>
          )}

          <div className="modal-actions">
            <button 
              type="button" 
              className="btn secondary" 
              onClick={onClose}
              disabled={isCreating}
            >
              Cancel
            </button>
            <button 
              type="submit" 
              className="btn primary"
              disabled={isCreating || !formData.name.trim()}
            >
              {isCreating ? (
                <>
                  <Loader size={16} className="spinning" />
                  Creating...
                </>
              ) : (
                'Create Session'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CreateSessionModal;
