import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  AutreOngletSqliteError,
  isOpfsLockError,
  __resetWebSqliteLockForTests,
} from './webSqliteLock.ts';

describe('webSqliteLock', () => {
  it('détecte NoModificationAllowedError', () => {
    assert.equal(
      isOpfsLockError(
        new Error(
          "NoModificationAllowedError: Failed to execute 'createSyncAccessHandle' on 'FileSystemFileHandle'"
        )
      ),
      true
    );
    assert.equal(isOpfsLockError(new AutreOngletSqliteError()), true);
    assert.equal(isOpfsLockError(new Error('autre chose')), false);
  });

  it('reset de test ne plante pas', () => {
    __resetWebSqliteLockForTests();
  });
});
